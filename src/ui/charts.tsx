'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoneyShort, formatNumber } from './format';

/**
 * Charts follow a few fixed rules so they read the same everywhere:
 *  - one measure per chart, one y-axis;
 *  - a single series is drawn in the chart blue, never in a business's brand colour
 *    (brand colours are for identity, not data);
 *  - comparisons between businesses are bars or small multiples with text labels, never a
 *    nine-colour legend;
 *  - every chart sits next to a table with the same numbers.
 */
const SERIES = '#2a78d6';
const GRID = '#e4e4e7';
const TEXT = '#71717a';

export type TrendPoint = { bucket: string; value: number };

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

/** Change over time for one measure. Hover shows the exact value for a day. */
export function TrendChart({
  data,
  format,
  label,
  height = 200,
}: {
  data: TrendPoint[];
  format: 'money' | 'number';
  label: string;
  height?: number;
}) {
  const show = (value: number) =>
    format === 'money' ? formatMoneyShort(value) : formatNumber(value);
  return (
    <div style={{ height }} role="img" aria-label={`${label} over time`}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID} vertical={false} />
          <XAxis
            dataKey="bucket"
            tickFormatter={shortDate}
            tick={{ fontSize: 11, fill: TEXT }}
            tickLine={false}
            axisLine={{ stroke: GRID }}
            minTickGap={32}
          />
          <YAxis
            tickFormatter={show}
            tick={{ fontSize: 11, fill: TEXT }}
            tickLine={false}
            axisLine={false}
            width={56}
            allowDecimals={false}
          />
          <Tooltip
            cursor={{ stroke: TEXT, strokeWidth: 1 }}
            formatter={(value) => [show(Number(value)), label]}
            labelFormatter={(bucket) => shortDate(String(bucket))}
            contentStyle={{
              borderRadius: 6,
              border: `1px solid ${GRID}`,
              fontSize: 12,
              padding: '6px 8px',
            }}
          />
          <Area
            type="linear"
            dataKey="value"
            stroke={SERIES}
            strokeWidth={2}
            fill={SERIES}
            fillOpacity={0.08}
            dot={false}
            activeDot={{ r: 4, stroke: '#fff', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A tiny trend line for a table cell. Decorative: the row's numbers carry the meaning. */
export function Sparkline({
  values,
  width = 96,
  height = 24,
}: {
  values: number[];
  width?: number;
  height?: number;
}) {
  if (values.length < 2) return <span className="text-xs text-zinc-400">—</span>;
  const max = Math.max(...values, 1);
  const step = (width - 2) / (values.length - 1);
  const points = values
    .map(
      (v, i) =>
        `${(1 + i * step).toFixed(1)},${(height - 2 - (v / max) * (height - 4)).toFixed(1)}`,
    )
    .join(' ');
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
      className="block"
    >
      <polyline
        points={points}
        fill="none"
        stroke={SERIES}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Horizontal bars comparing one measure across named things. Each bar is labelled in text. */
export function BarList({
  items,
  format,
}: {
  items: { label: string; value: number; prefix?: React.ReactNode }[];
  format: 'money' | 'number';
}) {
  const max = Math.max(...items.map((i) => i.value), 1);
  const show = (value: number) =>
    format === 'money' ? formatMoneyShort(value) : formatNumber(value);
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li
          key={item.label}
          className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-sm"
          title={`${item.label}: ${show(item.value)}`}
        >
          <span className="flex min-w-0 items-center gap-2 text-zinc-700">
            {item.prefix}
            <span className="truncate">{item.label}</span>
          </span>
          <span className="h-2.5 rounded-r bg-zinc-100">
            <span
              className="block h-full rounded-r"
              style={{
                width: `${Math.max((item.value / max) * 100, item.value > 0 ? 1 : 0)}%`,
                backgroundColor: SERIES,
              }}
            />
          </span>
          <span className="w-20 text-right text-zinc-900 tabular-nums">{show(item.value)}</span>
        </li>
      ))}
    </ul>
  );
}
