'use client';

import { sankey, sankeyLinkHorizontal } from 'd3-sankey';
import type { SankeyGraph, SankeyNode } from 'd3-sankey';
import { useEffect, useMemo, useRef, useState } from 'react';

type LeadFlowNodeId =
  | 'database'
  | 'evaluated'
  | 'outside-flow'
  | 'qualified'
  | 'not-qualified'
  | 'high'
  | 'medium'
  | 'low'
  | 'unbanded';

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
  qualified: number;
  notQualified: number;
  high: number;
  medium: number;
  low: number;
  unbanded: number;
};

const CHART_HEIGHT = 268;
const MIN_CHART_WIDTH = 520;
const NODE_WIDTH = 12;
const NODE_PADDING = 22;
const MARGIN = {
  top: 18,
  right: 132,
  bottom: 18,
  left: 132,
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
    label: 'Evaluated',
    layer: 1,
    order: 0,
    color: '#3CC8E0',
    labelSide: 'left',
  },
  {
    id: 'outside-flow',
    label: 'Not evaluated',
    layer: 1,
    order: 1,
    color: '#7B8494',
    labelSide: 'right',
  },
  {
    id: 'qualified',
    label: 'Qualified',
    layer: 2,
    order: 0,
    color: '#3CC8E0',
    labelSide: 'left',
  },
  {
    id: 'not-qualified',
    label: 'Not qualified',
    layer: 2,
    order: 1,
    color: '#E56F73',
    labelSide: 'right',
  },
  {
    id: 'high',
    label: 'High',
    layer: 3,
    order: 0,
    color: '#74F365',
    labelSide: 'right',
  },
  {
    id: 'medium',
    label: 'Medium',
    layer: 3,
    order: 1,
    color: '#F4CF45',
    labelSide: 'right',
  },
  {
    id: 'low',
    label: 'Low',
    layer: 3,
    order: 2,
    color: '#E56F73',
    labelSide: 'right',
  },
  {
    id: 'unbanded',
    label: 'Unscored',
    layer: 3,
    order: 3,
    color: '#A7B0BD',
    labelSide: 'right',
  },
];

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

function getNodeLabelPosition(node: LeadFlowNode) {
  const centerY = getNodeCenterY(node);

  if (node.id === 'not-qualified' || node.id === 'outside-flow') {
    return {
      anchor: 'start' as const,
      x: (node.x1 ?? 0) + 10,
      y: centerY + 4,
    };
  }

  if (node.labelSide === 'left') {
    return {
      anchor: 'end' as const,
      x: (node.x0 ?? 0) - 10,
      y: centerY - 4,
    };
  }

  return {
    anchor: 'start' as const,
    x: (node.x1 ?? 0) + 10,
    y: centerY + 4,
  };
}

function getLinks(data: LeadFlowSankeyData): LeadFlowLinkInput[] {
  const hasOutsideFlow = data.outsideFlow > 0;
  const qualificationSource = hasOutsideFlow ? 'evaluated' : 'database';
  const links: LeadFlowLinkInput[] = [];

  if (hasOutsideFlow) {
    links.push(
      {
        id: 'database-evaluated',
        source: 'database',
        target: 'evaluated',
        value: data.evaluated,
        color: '#3CC8E0',
        opacity: 0.5,
        order: 0,
      },
      {
        id: 'database-outside-flow',
        source: 'database',
        target: 'outside-flow',
        value: data.outsideFlow,
        color: '#7B8494',
        opacity: 0.22,
        order: 1,
      },
    );
  }

  links.push(
    {
      id: 'source-qualified',
      source: qualificationSource,
      target: 'qualified',
      value: data.qualified,
      color: '#3CC8E0',
      opacity: 0.6,
      order: 0,
    },
    {
      id: 'source-not-qualified',
      source: qualificationSource,
      target: 'not-qualified',
      value: data.notQualified,
      color: '#E56F73',
      opacity: 0.5,
      order: 1,
    },
    {
      id: 'qualified-high',
      source: 'qualified',
      target: 'high',
      value: data.high,
      color: '#74F365',
      opacity: 0.56,
      order: 0,
    },
    {
      id: 'qualified-medium',
      source: 'qualified',
      target: 'medium',
      value: data.medium,
      color: '#F4CF45',
      opacity: 0.52,
      order: 1,
    },
    {
      id: 'qualified-low',
      source: 'qualified',
      target: 'low',
      value: data.low,
      color: '#E56F73',
      opacity: 0.5,
      order: 2,
    },
    {
      id: 'qualified-unbanded',
      source: 'qualified',
      target: 'unbanded',
      value: data.unbanded,
      color: '#A7B0BD',
      opacity: 0.34,
      order: 3,
    },
  );

  return links;
}

function getLayoutLayer(node: LeadFlowNodeExtra, hasOutsideFlow: boolean): number {
  if (hasOutsideFlow || node.layer === 0) return node.layer;
  return node.layer - 1;
}

function buildLayout(width: number, data: LeadFlowSankeyData) {
  const links = getLinks(data).filter((link) => link.value > 0);
  const hasOutsideFlow = data.outsideFlow > 0;
  const nodeIds = new Set<LeadFlowNodeId>();
  for (const link of links) {
    nodeIds.add(link.source);
    nodeIds.add(link.target);
  }

  const graph: SankeyGraph<LeadFlowNodeExtra, LeadFlowLinkExtra> = {
    nodes: NODES.filter((node) => nodeIds.has(node.id)).map((node) => ({
      ...node,
      layer: getLayoutLayer(node, hasOutsideFlow),
    })),
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
      [MARGIN.left, MARGIN.top],
      [width - MARGIN.right, CHART_HEIGHT - MARGIN.bottom],
    ])
    .iterations(48)(graph);
}

export function LeadFlowSankey({ data }: { data: LeadFlowSankeyData }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const hasFlowData = data.totalBusinesses > 0 || data.evaluated > 0 || data.qualified > 0;
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
    <figure ref={ref} className="overflow-hidden rounded-xl border border-white/[0.07] bg-black/[0.12] p-3">
      <svg
        aria-label="Lead flow from database records through qualification and lead-fit bands"
        className="h-auto w-full"
        role="img"
        style={{ width }}
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
            const labelPosition = getNodeLabelPosition(node);
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
  );
}
