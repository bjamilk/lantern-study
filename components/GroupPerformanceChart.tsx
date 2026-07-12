

import React, { useEffect, useRef } from 'react';
import type { Chart as ChartType, ChartConfiguration, TooltipItem } from 'chart.js';

export interface ChartDataPoint {
  x: string; // Label for x-axis (e.g., "Test 1", "2023-10-26")
  y: number | null; // Score, can be null for gaps in data
}

interface ChartDataset {
  label: string;
  data: ChartDataPoint[];
}

interface GroupPerformanceChartProps {
  datasets: ChartDataset[];
  theme: 'light' | 'dark';
  type: 'bar' | 'line';
}

const COLORS = {
    light: [
        'rgba(79, 70, 229, 0.8)',   // lantern-primary
        'rgba(225, 29, 72, 0.8)',   // rose-600
        'rgba(13, 148, 136, 0.8)',  // teal-600
        'rgba(245, 158, 11, 0.8)',  // amber-600
        'rgba(14, 165, 233, 0.8)',  // sky-500
        'rgba(192, 38, 211, 0.8)',  // fuchsia-600
    ],
    dark: [
        'rgba(99, 102, 241, 0.8)',  // lantern-primary-light
        'rgba(251, 113, 133, 0.8)', // rose-400
        'rgba(45, 212, 191, 0.8)',  // teal-400
        'rgba(252, 211, 77, 0.8)',  // amber-400
        'rgba(56, 189, 248, 0.8)',  // sky-400
        'rgba(232, 121, 249, 0.8)', // fuchsia-400
    ],
};

const GroupPerformanceChart: React.FC<GroupPerformanceChartProps> = ({ datasets, theme, type }) => {
  const chartRef = useRef<HTMLCanvasElement>(null);
  const chartInstanceRef = useRef<ChartType | null>(null);

  useEffect(() => {
    let active = true;
    let localChartInstance: ChartType | null = null;

    if (chartRef.current && datasets.length > 0 && datasets.some(d => d.data.length > 0)) {
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy(); // Destroy previous instance
        chartInstanceRef.current = null;
      }

      const ctx = chartRef.current.getContext('2d');
      if (ctx) {
        const gridColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)';
        const ticksColor = theme === 'dark' ? '#94a3b8' : '#475569'; // lantern-text-tertiary / lantern-text-secondary
        const tooltipBackgroundColor = theme === 'dark' ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)';
        const tooltipTitleColor = theme === 'dark' ? '#f1f5f9' : '#1e293b';
        const tooltipBodyColor = theme === 'dark' ? '#e2e8f0' : '#334155';
        const uniqueLabels = [...new Set(datasets.flatMap(d => d.data.map(p => p.x)))].sort();
        const chartColors = COLORS[theme];

        // Dynamic import
        import('chart.js').then(({ Chart, registerables }) => {
          if (!active) return;
          Chart.register(...registerables);

          const chartConfig: ChartConfiguration = {
            type: type,
            data: {
              labels: uniqueLabels,
              datasets: datasets.map((dataset, index) => {
                  const color = chartColors[index % chartColors.length];
                  let datasetOptions: any;

                  // Align data with unique labels, inserting null for missing points
                  const dataMap = new Map(dataset.data.map(p => [p.x, p.y]));
                  const alignedData = uniqueLabels.map(label => dataMap.get(label) ?? null);

                  if (type === 'line') {
                      datasetOptions = {
                          borderColor: color,
                          backgroundColor: color.replace('0.8', '0.2'),
                          fill: true,
                          tension: 0.3,
                          pointBackgroundColor: color,
                          pointRadius: 3,
                          pointHoverRadius: 5,
                          spanGaps: true, // Connect lines over null data points
                      };
                  } else { // bar
                      datasetOptions = {
                          backgroundColor: color.replace('0.8', '0.65'),
                          borderColor: color,
                          borderWidth: 1,
                          borderRadius: 4,
                          hoverBackgroundColor: color,
                      };
                  }

                  return {
                      label: dataset.label,
                      data: alignedData,
                      ...datasetOptions
                  };
              })
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              scales: {
                y: {
                  beginAtZero: true,
                  max: 100,
                  title: { display: false },
                  grid: { color: gridColor },
                  ticks: { color: ticksColor, padding: 8, callback: (value) => `${value}%` }
                },
                x: {
                  title: { display: false },
                  grid: { display: false },
                  ticks: { color: ticksColor, padding: 8 }
                }
              },
              plugins: {
                legend: {
                  display: datasets.length > 1,
                  position: 'bottom',
                  labels: {
                    color: ticksColor,
                    padding: 15,
                    usePointStyle: true,
                  }
                },
                tooltip: {
                  enabled: true,
                  backgroundColor: tooltipBackgroundColor,
                  titleColor: tooltipTitleColor,
                  bodyColor: tooltipBodyColor,
                  borderColor: gridColor,
                  borderWidth: 1,
                  padding: 10,
                  cornerRadius: 4,
                  displayColors: datasets.length > 1, 
                  callbacks: {
                    label: function(context: TooltipItem<any>) {
                      let label = context.dataset.label || '';
                      if (label) {
                        label += ': ';
                      }
                      if (typeof context.parsed.y === 'number') {
                         label += `${context.parsed.y.toFixed(1)}%`;
                      }
                      return label;
                    }
                  }
                }
              },
              interaction: {
                intersect: false,
                mode: 'index',
              },
            }
          };

          if (chartRef.current) {
            localChartInstance = new Chart(ctx, chartConfig);
            chartInstanceRef.current = localChartInstance;
          }
        }).catch(err => {
          console.error('Failed to load chart.js dynamically:', err);
        });
      }
    }

    return () => {
      active = false;
      if (localChartInstance) {
        localChartInstance.destroy();
      }
      if (chartInstanceRef.current) {
        chartInstanceRef.current.destroy();
        chartInstanceRef.current = null;
      }
    };
  }, [datasets, theme, type]);

  if (datasets.length === 0 || datasets.every(d => d.data.length === 0)) {
     return (
        <div className="text-center py-6 px-4 text-sm text-lantern-text-secondary bg-lantern-background dark:bg-lantern-surface-secondary/50 rounded-md mt-3">
            <p>No test data available for this view.</p>
        </div>
        );
  }

  return (
    <div className="h-60 md:h-64 my-2 p-2 bg-lantern-background-secondary/30 rounded-lg shadow-inner">
      <canvas ref={chartRef}></canvas>
    </div>
  );
};

export default GroupPerformanceChart;
