import React from 'react';
import { View, Image, StyleSheet, LayoutChangeEvent } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import type { Flashcard } from '@lantern/shared/types';
import {
  getBlurRegions,
  getFreeformPaths,
  formatFreeformPointsForSvg,
} from '@lantern/shared/utils';

interface ImageOcclusionViewProps {
  card: Flashcard;
  showAnswer: boolean;
}

export function ImageOcclusionView({ card, showAnswer }: ImageOcclusionViewProps) {
  const [layout, setLayout] = React.useState({ width: 0, height: 0 });
  const overlayOpacity = showAnswer ? 0 : 1;

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setLayout({ width, height });
  };

  if (!card.imageUrl) {
    return null;
  }

  const data = card.occlusionData;

  return (
    <View style={styles.wrapper} onLayout={onLayout}>
      <Image source={{ uri: card.imageUrl }} style={styles.image} resizeMode="contain" />
      {layout.width > 0 && layout.height > 0 ? (
        <View style={[StyleSheet.absoluteFill, { opacity: overlayOpacity }]} pointerEvents="none">
          {data?.type === 'rectangles' &&
            data.rectangles?.map((rect, idx) => (
              <View
                key={`r-${idx}`}
                style={[
                  styles.mask,
                  {
                    left: rect.x * layout.width,
                    top: rect.y * layout.height,
                    width: rect.width * layout.width,
                    height: rect.height * layout.height,
                  },
                ]}
              />
            ))}
          {data?.type === 'circles' &&
            data.circles?.map((circle, idx) => (
              <View
                key={`c-${idx}`}
                style={[
                  styles.mask,
                  styles.circle,
                  {
                    left: (circle.x - circle.radius) * layout.width,
                    top: (circle.y - circle.radius) * layout.height,
                    width: circle.radius * 2 * layout.width,
                    height: circle.radius * 2 * layout.height,
                    borderRadius: circle.radius * layout.width,
                  },
                ]}
              />
            ))}
          {data?.type === 'freeform' && getFreeformPaths(data).length > 0 ? (
            <Svg width={layout.width} height={layout.height} style={StyleSheet.absoluteFill}>
              {getFreeformPaths(data).map((path, idx) => (
                <Polygon
                  key={`f-${idx}`}
                  points={formatFreeformPointsForSvg(path.points)
                    .split(' ')
                    .map(pair => {
                      const [x, y] = pair.split(',').map(Number);
                      return `${x * layout.width},${y * layout.height}`;
                    })
                    .join(' ')}
                  fill="rgba(0,0,0,0.7)"
                  stroke="rgba(255,255,255,0.7)"
                  strokeWidth={1}
                />
              ))}
            </Svg>
          ) : null}
          {data?.type === 'blur' &&
            getBlurRegions(data).map((blur, idx) => (
              <View
                key={`b-${idx}`}
                style={[
                  styles.blurMask,
                  {
                    left: blur.x * layout.width,
                    top: blur.y * layout.height,
                    width: blur.width * layout.width,
                    height: blur.height * layout.height,
                    backgroundColor: `rgba(255,255,255,${blur.opacity ?? 0.4})`,
                  },
                ]}
              />
            ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    maxHeight: 320,
    alignSelf: 'center',
    position: 'relative',
  },
  image: {
    width: '100%',
    height: 280,
    borderRadius: 12,
  },
  mask: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  circle: {
    borderRadius: 9999,
  },
  blurMask: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
});

export default ImageOcclusionView;
