/**
 * Draw occlusion masks over an image by dragging.
 *
 * Every shape is stored in normalised 0–1 coordinates relative to the displayed
 * image box, which is exactly what ImageOcclusionView expects when it replays
 * them — and what web writes — so a card drawn here reviews identically on web,
 * iOS and Android regardless of screen size.
 */
import React, { useMemo, useRef, useState } from 'react';
import {
  Image,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import type { OcclusionData } from '@lantern/shared';

export type OcclusionMode = 'rectangles' | 'circles' | 'freeform' | 'blur';

interface Point {
  x: number;
  y: number;
}

interface OcclusionEditorProps {
  imageUri: string;
  value: OcclusionData | null;
  onChange: (data: OcclusionData) => void;
  mode: OcclusionMode;
  onModeChange: (mode: OcclusionMode) => void;
}

const BLUR_OPACITY = 0.45;
/** Ignore stray taps — a mask smaller than this is almost certainly a mis-touch. */
const MIN_SIZE = 0.02;

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function OcclusionEditor({
  imageUri,
  value,
  onChange,
  mode,
  onModeChange,
}: OcclusionEditorProps) {
  const [layout, setLayout] = useState({ width: 0, height: 0 });
  const [draft, setDraft] = useState<{ start: Point; current: Point; path: Point[] } | null>(null);

  // PanResponder closes over these, so they have to be refs rather than state.
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const valueRef = useRef(value);
  valueRef.current = value;
  const draftRef = useRef(draft);
  draftRef.current = draft;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  };

  const toNormalised = (locationX: number, locationY: number): Point => {
    const { width, height } = layoutRef.current;
    if (!width || !height) return { x: 0, y: 0 };
    return { x: clamp01(locationX / width), y: clamp01(locationY / height) };
  };

  const commitDraft = () => {
    const current = draftRef.current;
    const data = valueRef.current;
    const activeMode = modeRef.current;
    setDraft(null);
    if (!current) return;

    const { start, current: end, path } = current;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    if (activeMode === 'freeform') {
      if (path.length < 3) return;
      const existing = data?.type === 'freeform' ? (data.freeforms ?? []) : [];
      onChange({ type: 'freeform', freeforms: [...existing, { points: path }] });
      return;
    }

    if (width < MIN_SIZE || height < MIN_SIZE) return;

    if (activeMode === 'rectangles') {
      const existing = data?.type === 'rectangles' ? (data.rectangles ?? []) : [];
      onChange({ type: 'rectangles', rectangles: [...existing, { x, y, width, height }] });
      return;
    }

    if (activeMode === 'circles') {
      // Drag from the centre outwards; the radius is normalised against width so
      // the circle stays round when replayed.
      const radius = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y)) / 2;
      if (radius < MIN_SIZE) return;
      const existing = data?.type === 'circles' ? (data.circles ?? []) : [];
      onChange({
        type: 'circles',
        circles: [...existing, { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2, radius }],
      });
      return;
    }

    const existing = data?.type === 'blur' ? (data.blur ?? []) : [];
    onChange({
      type: 'blur',
      blur: [...existing, { x, y, width, height, radius: 8, opacity: BLUR_OPACITY }],
    });
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (e) => {
          const p = toNormalised(e.nativeEvent.locationX, e.nativeEvent.locationY);
          setDraft({ start: p, current: p, path: [p] });
        },
        onPanResponderMove: (e) => {
          const p = toNormalised(e.nativeEvent.locationX, e.nativeEvent.locationY);
          setDraft((prev) =>
            prev
              ? {
                  start: prev.start,
                  current: p,
                  // Thin the path so a long drag does not store hundreds of points.
                  path:
                    modeRef.current === 'freeform' && distance(prev.path[prev.path.length - 1], p) > 0.01
                      ? [...prev.path, p]
                      : prev.path,
                }
              : prev
          );
        },
        onPanResponderRelease: commitDraft,
        onPanResponderTerminate: commitDraft,
      }),
    []
  );

  const shapeCount = countShapes(value);

  const undo = () => {
    if (!value) return;
    if (value.type === 'rectangles') {
      onChange({ type: 'rectangles', rectangles: (value.rectangles ?? []).slice(0, -1) });
    } else if (value.type === 'circles') {
      onChange({ type: 'circles', circles: (value.circles ?? []).slice(0, -1) });
    } else if (value.type === 'freeform') {
      onChange({ type: 'freeform', freeforms: (value.freeforms ?? []).slice(0, -1) });
    } else {
      onChange({ type: 'blur', blur: (value.blur ?? []).slice(0, -1) });
    }
  };

  const clear = () => onChange({ type: mode });

  const ModeChip = ({ id, label }: { id: OcclusionMode; label: string }) => (
    <Pressable
      onPress={() => {
        // Switching shape type replaces the set, because OcclusionData holds one
        // kind at a time — say so rather than dropping work silently.
        if (shapeCount > 0 && id !== mode) onChange({ type: id });
        onModeChange(id);
      }}
      accessibilityRole="button"
      accessibilityState={{ selected: mode === id }}
      className={`px-3 py-1.5 rounded-full ${
        mode === id ? 'bg-lantern-primary' : 'bg-lantern-background-secondary'
      }`}
    >
      <Text
        className={`text-xs font-semibold ${
          mode === id ? 'text-white' : 'text-lantern-text-secondary'
        }`}
      >
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View>
      <View className="flex-row flex-wrap gap-2 mb-2">
        <ModeChip id="rectangles" label="Box" />
        <ModeChip id="circles" label="Circle" />
        <ModeChip id="freeform" label="Freehand" />
        <ModeChip id="blur" label="Blur" />
      </View>

      <View
        onLayout={onLayout}
        {...panResponder.panHandlers}
        style={styles.canvas}
        accessibilityLabel="Drag on the image to hide a region"
      >
        <Image source={{ uri: imageUri }} style={styles.image} resizeMode="contain" />
        {layout.width > 0 ? (
          <View style={StyleSheet.absoluteFill} pointerEvents="none">
            {renderSaved(value, layout)}
            {renderDraft(draft, mode, layout)}
          </View>
        ) : null}
      </View>

      <View className="flex-row items-center justify-between mt-2">
        <Text className="text-[11px] text-lantern-text-secondary flex-1">
          {shapeCount === 0
            ? 'Drag across the image to hide a region.'
            : `${shapeCount} region${shapeCount === 1 ? '' : 's'} hidden.`}
        </Text>
        <View className="flex-row gap-2">
          <Pressable
            onPress={undo}
            disabled={shapeCount === 0}
            accessibilityRole="button"
            accessibilityLabel="Undo last region"
            className={`px-3 py-1.5 rounded-full bg-lantern-background-secondary ${
              shapeCount === 0 ? 'opacity-40' : 'active:opacity-80'
            }`}
          >
            <Text className="text-xs font-semibold text-lantern-primary">Undo</Text>
          </Pressable>
          <Pressable
            onPress={clear}
            disabled={shapeCount === 0}
            accessibilityRole="button"
            accessibilityLabel="Clear all regions"
            className={`px-3 py-1.5 rounded-full bg-lantern-background-secondary ${
              shapeCount === 0 ? 'opacity-40' : 'active:opacity-80'
            }`}
          >
            <Text className="text-xs font-semibold text-red-500">Clear</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function distance(a: Point | undefined, b: Point): number {
  if (!a) return Number.POSITIVE_INFINITY;
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function countShapes(data: OcclusionData | null | undefined): number {
  if (!data) return 0;
  if (data.type === 'rectangles') return data.rectangles?.length ?? 0;
  if (data.type === 'circles') return data.circles?.length ?? 0;
  if (data.type === 'freeform') return data.freeforms?.length ?? (data.freeform ? 1 : 0);
  return data.blur?.length ?? 0;
}

function renderSaved(data: OcclusionData | null, layout: { width: number; height: number }) {
  if (!data) return null;
  const { width, height } = layout;

  if (data.type === 'rectangles') {
    return (data.rectangles ?? []).map((r, i) => (
      <View
        key={`r${i}`}
        style={[
          styles.mask,
          { left: r.x * width, top: r.y * height, width: r.width * width, height: r.height * height },
        ]}
      />
    ));
  }
  if (data.type === 'circles') {
    return (data.circles ?? []).map((c, i) => (
      <View
        key={`c${i}`}
        style={[
          styles.mask,
          {
            left: (c.x - c.radius) * width,
            top: (c.y - c.radius) * height,
            width: c.radius * 2 * width,
            height: c.radius * 2 * height,
            borderRadius: c.radius * width,
          },
        ]}
      />
    ));
  }
  if (data.type === 'blur') {
    return (data.blur ?? []).map((b, i) => (
      <View
        key={`b${i}`}
        style={[
          styles.mask,
          {
            left: b.x * width,
            top: b.y * height,
            width: b.width * width,
            height: b.height * height,
            backgroundColor: `rgba(255,255,255,${b.opacity ?? BLUR_OPACITY})`,
          },
        ]}
      />
    ));
  }
  const paths = data.freeforms ?? (data.freeform ? [data.freeform] : []);
  if (paths.length === 0) return null;
  return (
    <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
      {paths.map((p, i) => (
        <Polygon
          key={`f${i}`}
          points={p.points.map((pt) => `${pt.x * width},${pt.y * height}`).join(' ')}
          fill="rgba(0,0,0,0.7)"
          stroke="rgba(255,255,255,0.7)"
          strokeWidth={1}
        />
      ))}
    </Svg>
  );
}

function renderDraft(
  draft: { start: Point; current: Point; path: Point[] } | null,
  mode: OcclusionMode,
  layout: { width: number; height: number }
) {
  if (!draft) return null;
  const { width, height } = layout;
  const { start, current, path } = draft;

  if (mode === 'freeform') {
    if (path.length < 2) return null;
    return (
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Polygon
          points={path.map((pt) => `${pt.x * width},${pt.y * height}`).join(' ')}
          fill="rgba(99,102,241,0.35)"
          stroke="#6366f1"
          strokeWidth={2}
        />
      </Svg>
    );
  }

  if (mode === 'circles') {
    const radius = Math.max(Math.abs(current.x - start.x), Math.abs(current.y - start.y)) / 2;
    return (
      <View
        style={[
          styles.draft,
          {
            left: ((start.x + current.x) / 2 - radius) * width,
            top: ((start.y + current.y) / 2 - radius) * height,
            width: radius * 2 * width,
            height: radius * 2 * height,
            borderRadius: radius * width,
          },
        ]}
      />
    );
  }

  return (
    <View
      style={[
        styles.draft,
        {
          left: Math.min(start.x, current.x) * width,
          top: Math.min(start.y, current.y) * height,
          width: Math.abs(current.x - start.x) * width,
          height: Math.abs(current.y - start.y) * height,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  canvas: {
    width: '100%',
    height: 260,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#0f172a10',
    position: 'relative',
  },
  image: { width: '100%', height: '100%' },
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  draft: {
    position: 'absolute',
    backgroundColor: 'rgba(99,102,241,0.35)',
    borderWidth: 2,
    borderColor: '#6366f1',
  },
});

export default OcclusionEditor;
