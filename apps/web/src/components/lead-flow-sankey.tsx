'use client';

import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyGraph, SankeyNode } from 'd3-sankey';
import { useEffect, useMemo, useRef, useState } from 'react';

type LeadFlowNodeId =
  | 'database'
  | 'evaluated'
  | 'duplicates'
  | 'not-qualified'
  | 'high'
  | 'medium'
  | 'low';

type LeadFlowNodeExtra = {
  id: LeadFlowNodeId;
  label: string;
  layer: number;
  order: number;
  color: string;
  labelSide: 'left' | 'right';
  showLabel?: boolean;
};

type LeadFlowLinkExtra = {
  id: string;
  color: string;
  opacity: number;
  order: number;
};

type LeadFlowLinkInput = LeadFlowLinkExtra & {
  source: LeadFlowNodeId;
  target: LeadFlowNodeId;
  value: number;
};

type LeadFlowNode = SankeyNode<LeadFlowNodeExtra, LeadFlowLinkExtra>;

export type LeadFlowSankeyData = {
  totalBusinesses: number;
  evaluated: number;
  outsideFlow: number;
  duplicates?: number | undefined;
  qualified: number;
  notQualified: number;
  high: number;
  medium: number;
  low: number;
  unbanded: number;
  sourceLabel?: string | undefined;
  screenedLabel?: string | undefined;
  duplicateLabel?: string | undefined;
  disqualifiedLabel?: string | undefined;
  highLabel?: string | undefined;
  mediumLabel?: string | undefined;
  lowLabel?: string | undefined;
};

const CHART_HEIGHT = 326;
const MIN_CHART_WIDTH = 640;
const NODE_WIDTH = 12;
const NODE_PADDING = 22;
const WIDE_MARGIN = {
  top: 18,
  right: 118,
  bottom: 18,
  left: 124,
};
const COMPACT_MARGIN = {
  top: 18,
  right: 74,
  bottom: 18,
  left: 76,
};

const NODES: LeadFlowNodeExtra[] = [
  {
    id: 'database',
    label: 'Businesses',
    layer: 0,
    order: 0,
    color: '#D9DEE5',
    labelSide: 'left',
  },
  {
    id: 'evaluated',
    label: 'Screened',
    layer: 1,
    order: 0,
    color: '#3CC8E0',
    labelSide: 'right',
  },
  {
    id: 'duplicates',
    label: 'Duplicates',
    layer: 1,
    order: 1,
    color: '#7B8494',
    labelSide: 'right',
  },
  {
    id: 'high',
    label: 'High',
    layer: 2,
    order: 0,
    color: '#74F365',
    labelSide: 'right',
  },
  {
    id: 'medium',
    label: 'Medium',
    layer: 2,
    order: 1,
    color: '#F4CF45',
    labelSide: 'right',
  },
  {
    id: 'low',
    label: 'Low',
    layer: 2,
    order: 2,
    color: '#E56F73',
    labelSide: 'right',
  },
  {
    id: 'not-qualified',
    label: 'Disqualified',
    layer: 2,
    order: 3,
    color: '#E56F73',
    labelSide: 'right',
  },
];

function getNodes(data: LeadFlowSankeyData): LeadFlowNodeExtra[] {
  const labelOverrides: Partial<Record<LeadFlowNodeId, string | undefined>> = {
    database: data.sourceLabel,
    evaluated: data.screenedLabel,
    duplicates: data.duplicateLabel,
    'not-qualified': data.disqualifiedLabel,
    high: data.highLabel,
    medium: data.mediumLabel,
    low: data.lowLabel,
  };

  return NODES.map((node) => ({
    ...node,
    label: labelOverrides[node.id] ?? node.label,
  }));
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString();
}

function useElementWidth<TElement extends HTMLElement>() {
  const ref = useRef<TElement | null>(null);
  const [width, setWidth] = useState(MIN_CHART_WIDTH);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const updateWidth = () => {
      setWidth(Math.max(MIN_CHART_WIDTH, Math.round(element.getBoundingClientRect().width)));
    };
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(element);

    return () => observer.disconnect();
  }, []);

  return { ref, width };
}

function splitLabel(label: string): string[] {
  return [label];
}

function getNodeCenterY(node: LeadFlowNode): number {
  return ((node.y0 ?? 0) + (node.y1 ?? 0)) / 2;
}

function getNodeCenterX(node: LeadFlowNode): number {
  return ((node.x0 ?? 0) + (node.x1 ?? 0)) / 2;
}

function getNodeLabelPosition(node: LeadFlowNode, width: number) {
  const centerY = getNodeCenterY(node);
  const compact = width < 460;

  if (node.id === 'not-qualified' || node.id === 'duplicates') {
    return {
      anchor: 'start' as const,
      x: compact ? Math.min((node.x1 ?? 0) + 8, width - 62) : (node.x1 ?? 0) + 10,
      y: centerY + 4,
    };
  }

  if (node.labelSide === 'left') {
    return {
      anchor: 'end' as const,
      x: compact ? Math.max((node.x0 ?? 0) - 8, 62) : (node.x0 ?? 0) - 10,
      y: centerY - 4,
    };
  }

  return {
    anchor: 'start' as const,
    x: compact ? Math.min((node.x1 ?? 0) + 8, width - 48) : (node.x1 ?? 0) + 10,
    y: centerY + 4,
  };
}

function getLinks(data: LeadFlowSankeyData): LeadFlowLinkInput[] {
  const duplicates = Math.max(0, data.duplicates ?? 0);
  return [
    {
      id: 'database-evaluated',
      source: 'database',
      target: 'evaluated',
      value: data.evaluated,
      color: '#3CC8E0',
      opacity: 0.46,
      order: 0,
    },
    {
      id: 'database-duplicates',
      source: 'database',
      target: 'duplicates',
      value: duplicates,
      color: '#7B8494',
      opacity: 0.26,
      order: 1,
    },
    {
      id: 'evaluated-high',
      source: 'evaluated',
      target: 'high',
      value: data.high,
      color: '#74F365',
      opacity: 0.56,
      order: 0,
    },
    {
      id: 'evaluated-medium',
      source: 'evaluated',
      target: 'medium',
      value: data.medium,
      color: '#F4CF45',
      opacity: 0.52,
      order: 1,
    },
    {
      id: 'evaluated-low',
      source: 'evaluated',
      target: 'low',
      value: data.low,
      color: '#E56F73',
      opacity: 0.5,
      order: 2,
    },
    {
      id: 'evaluated-disqualified',
      source: 'evaluated',
      target: 'not-qualified',
      value: data.notQualified,
      color: '#E56F73',
      opacity: 0.46,
      order: 3,
    },
  ];
}

function buildLayout(width: number, data: LeadFlowSankeyData) {
  const links = getLinks(data).filter((link) => link.value > 0);
  const margin = width < 460 ? COMPACT_MARGIN : WIDE_MARGIN;
  const nodeIds = new Set<LeadFlowNodeId>();
  for (const link of links) {
    nodeIds.add(link.source);
    nodeIds.add(link.target);
  }

  const graph: SankeyGraph<LeadFlowNodeExtra, LeadFlowLinkExtra> = {
    nodes: getNodes(data).filter((node) => nodeIds.has(node.id)),
    links: links.map((link) => ({ ...link })),
  };

  return sankey<LeadFlowNodeExtra, LeadFlowLinkExtra>()
    .nodeId((node) => node.id)
    .nodeAlign((node) => node.layer)
    .nodeWidth(NODE_WIDTH)
    .nodePadding(NODE_PADDING)
    .nodeSort((a, b) => a.order - b.order)
    .linkSort((a, b) => a.order - b.order)
    .extent([
      [margin.left, margin.top],
      [width - margin.right, CHART_HEIGHT - margin.bottom],
    ])
    .iterations(48)(graph);
}

function LeadFlowCompactSummary({ data }: { data: LeadFlowSankeyData }) {
  const priorityBandCount = data.high + data.medium;
  const duplicateCount = Math.max(0, data.duplicates ?? 0);
  const sourceLabel = data.sourceLabel ?? 'Businesses';
  const screenedLabel = data.screenedLabel ?? 'Screened businesses';
  const duplicateLabel = data.duplicateLabel ?? 'Duplicates';
  const disqualifiedLabel = data.disqualifiedLabel ?? 'Disqualified';

  return (
    <figure
      aria-label="Lead flow summary from source database through screening and lead bands"
      className="rounded-xl border border-white/[0.07] bg-black/[0.12] p-4 md:hidden"
    >
      <div className="grid gap-3 text-white">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">{sourceLabel}</p>
          <p className="mt-1 text-2xl font-extrabold tracking-tight">{formatCount(data.totalBusinesses)}</p>
          <p className="text-xs font-medium text-white/70">business records</p>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-zbooni-teal">{screenedLabel}</p>
            <p className="mt-1 text-lg font-extrabold">{formatCount(data.evaluated)}</p>
            <p className="text-xs text-white/70">ready for scoring</p>
          </div>
          <div>
            {duplicateCount > 0 ? (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">{duplicateLabel}</p>
                <p className="mt-1 text-lg font-extrabold">{formatCount(duplicateCount)}</p>
                <p className="text-xs text-white/70">already known</p>
              </>
            ) : (
              <>
                <p className="text-[11px] font-bold uppercase tracking-wider text-zbooni-green">Priority bands</p>
                <p className="mt-1 text-lg font-extrabold">{formatCount(priorityBandCount)}</p>
                <p className="text-xs text-white/70">high and medium fit</p>
              </>
            )}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 border-t border-white/[0.08] pt-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/60">Low score</p>
            <p className="mt-1 text-lg font-extrabold">{formatCount(data.low)}</p>
            <p className="text-xs text-white/70">kept out of priority review</p>
          </div>
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-rose-200">{disqualifiedLabel}</p>
            <p className="mt-1 text-lg font-extrabold">{formatCount(data.notQualified)}</p>
            <p className="text-xs text-white/70">not in the review pool</p>
          </div>
        </div>
      </div>
    </figure>
  );
}

export function LeadFlowSankey({ data }: { data: LeadFlowSankeyData }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const hasFlowData =
    data.totalBusinesses > 0 || data.evaluated > 0 || data.qualified > 0 || (data.duplicates ?? 0) > 0;
  const layout = useMemo(() => {
    if (!hasFlowData) return { nodes: [], links: [] };
    return buildLayout(width, data);
  }, [data, hasFlowData, width]);
  const linkPath = useMemo(() => sankeyLinkHorizontal<LeadFlowNodeExtra, LeadFlowLinkExtra>(), []);

  if (!hasFlowData) {
    return (
      <figure className="flex min-h-[220px] items-center justify-center rounded-xl border border-white/[0.07] bg-black/[0.12] p-6 text-center">
        <div>
          <p className="text-sm font-bold text-white">No lead flow for the selected filters</p>
          <p className="mt-1 text-xs font-medium text-white/70">
            Try All Time or a broader ICP selection.
          </p>
        </div>
      </figure>
    );
  }

  return (
    <>
      <LeadFlowCompactSummary data={data} />
      <figure
        ref={ref}
        className="hidden overflow-hidden rounded-xl border border-white/[0.07] bg-black/[0.12] p-3 md:block"
      >
        <svg
          aria-label="Lead flow from source database through screening and lead-fit bands"
          className="h-auto w-full"
          role="img"
          viewBox={`0 0 ${width} ${CHART_HEIGHT}`}
        >
          <g fill="none">
            {layout.links.map((link) => (
              <path
                key={link.id}
                d={linkPath(link) ?? undefined}
                stroke={link.color}
                strokeLinecap="butt"
                strokeOpacity={link.opacity}
                strokeWidth={Math.max(1, link.width ?? 0)}
              />
            ))}
          </g>

          <g>
            {layout.nodes.map((node) => (
              <rect
                key={node.id}
                fill={node.color}
                height={(node.y1 ?? 0) - (node.y0 ?? 0)}
                rx={4}
                width={(node.x1 ?? 0) - (node.x0 ?? 0)}
                x={node.x0}
                y={node.y0}
              />
            ))}
          </g>

          <g>
            {layout.nodes.map((node) => {
              if (node.showLabel === false) return null;
              const labelPosition = getNodeLabelPosition(node, width);
              const labelLines = splitLabel(node.label);
              const labelX = labelPosition.x;
              return (
                <text
                  key={node.id}
                  fill="#FFFFFF"
                  fontSize={12}
                  fontWeight={700}
                  textAnchor={labelPosition.anchor}
                  x={labelX}
                  y={labelPosition.y}
                >
                  <tspan x={labelX}>{formatCount(node.value ?? 0)}</tspan>
                  {labelLines.map((line, index) => (
                    <tspan key={`${node.id}-${line}`} dy={index === 0 ? 14 : 13} x={labelX}>
                      {line}
                    </tspan>
                  ))}
                </text>
              );
            })}
          </g>

          <g aria-hidden="true">
            {layout.links.map((link) => {
              const source = link.source as LeadFlowNode;
              const target = link.target as LeadFlowNode;
              return (
                <line
                  key={`${link.id}-balance`}
                  opacity={0}
                  strokeWidth={Math.max(1, link.width ?? 0)}
                  x1={getNodeCenterX(source)}
                  x2={getNodeCenterX(target)}
                  y1={link.y0}
                  y2={link.y1}
                />
              );
            })}
          </g>
        </svg>
      </figure>
    </>
  );
}
