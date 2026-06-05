import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Grid3x3, Sparkles, Bot, Workflow, GitBranch, AlignHorizontalSpaceAround } from "lucide-react";
import { nodeTemplates, getNodeTemplate } from "./lib/node-templates";
import AIWorkflowAssistant from "./AIWorkflowAssistant";
import type { NodeConnection, WorkflowCanvas, WorkflowNode, NodePosition, NodeTemplate } from "./types/workflow-canvas";

const canvasStorageKey = "4ever.inspiration.canvas";
const nodeWidth = 240;
const nodeHeaderHeight = 52;
const nodePortRowHeight = 20;

type CanvasNodeStatus = "ready" | "entry" | "exit" | "isolated" | "blocked" | "cycle";

const nodeLibraryGroups: Array<{ category: NodeTemplate["category"]; title: string }> = [
  { category: "trigger", title: "触发" },
  { category: "action", title: "系统动作" },
  { category: "data", title: "系统数据" },
];

export default function InspirationCanvasPanel() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<WorkflowCanvas>(loadCanvas);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<NodePosition>({ x: 0, y: 0 });
  const zoom = 1;
  const [pan, setPan] = useState<NodePosition>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<NodePosition>({ x: 0, y: 0 });
  const [showNodeLibrary, setShowNodeLibrary] = useState(true);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [notice, setNotice] = useState("先用 AI 助手生成流程，或从节点库手动添加节点。");
  const [connectionDraft, setConnectionDraft] = useState<{ nodeId: string; handle: string } | null>(null);
  const flowDiagnostic = diagnoseCanvasFlow(canvas);
  const flowIssue = flowDiagnostic.issue;
  const flowSummary = summarizeCanvasFlow(canvas);
  const canvasBounds = canvasContentBounds(canvas.nodes);

  // 保存画布到本地存储
  useEffect(() => {
    const saveTimer = window.setTimeout(() => {
      try {
        localStorage.setItem(canvasStorageKey, JSON.stringify(canvas));
      } catch (error) {
        console.error("Failed to save canvas:", error);
      }
    }, 180);
    return () => window.clearTimeout(saveTimer);
  }, [canvas]);

  // 添加节点到画布
  const addNode = useCallback((template: NodeTemplate, position?: NodePosition) => {
    let nextSelectedNode = "";
    let nextNotice = "";
    setCanvas((prev) => {
      const newNode = createCanvasNode(template, prev.nodes.length, position);
      nextSelectedNode = newNode.id;
      nextNotice = prev.nodes.length ? `已新增节点并连接到上一节点：${newNode.label}` : `已新增节点：${newNode.label}`;
      return {
        ...prev,
        nodes: [...prev.nodes, newNode],
        connections: prev.nodes.length ? [...prev.connections, autoConnection(prev.nodes[prev.nodes.length - 1], newNode)] : prev.connections,
        updatedAt: new Date().toISOString(),
      };
    });
    setSelectedNode(nextSelectedNode);
    setNotice(nextNotice);
  }, []);

  // 删除节点
  const deleteNode = useCallback((nodeId: string) => {
    setCanvas((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      connections: prev.connections.filter((c) => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId),
      updatedAt: new Date().toISOString(),
    }));
    setSelectedNode(null);
    setConnectionDraft(null);
    setNotice("已删除节点。");
  }, []);

  const startConnection = useCallback((event: React.MouseEvent, nodeId: string, handle: string) => {
    event.stopPropagation();
    setConnectionDraft({ nodeId, handle });
    setSelectedNode(nodeId);
    setNotice("已选择输出端口，再点击另一个节点的输入端口完成连接。");
  }, []);

  const completeConnection = useCallback((event: React.MouseEvent, targetNodeId: string, targetHandle: string) => {
    event.stopPropagation();
    if (!connectionDraft) {
      setNotice("请先点击一个输出端口，再连接到输入端口。");
      return;
    }
    if (connectionDraft.nodeId === targetNodeId) {
      setNotice("不能把节点连接到自己。请选择另一个节点的输入端口。");
      return;
    }
    const connection: NodeConnection = {
      id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      sourceNodeId: connectionDraft.nodeId,
      sourceHandle: connectionDraft.handle,
      targetNodeId,
      targetHandle,
    };
    setCanvas((prev) => {
      const exists = prev.connections.some((item) => item.sourceNodeId === connection.sourceNodeId && item.sourceHandle === connection.sourceHandle && item.targetNodeId === connection.targetNodeId && item.targetHandle === connection.targetHandle);
      return {
        ...prev,
        connections: exists ? prev.connections : [...prev.connections, connection],
        updatedAt: new Date().toISOString(),
      };
    });
    setConnectionDraft(null);
    setSelectedNode(targetNodeId);
    setNotice("节点已连接，流程线会随节点移动自动更新。");
  }, [connectionDraft]);

  const deleteConnection = useCallback((connectionId: string) => {
    setCanvas((prev) => ({
      ...prev,
      connections: prev.connections.filter((connection) => connection.id !== connectionId),
      updatedAt: new Date().toISOString(),
    }));
    setNotice("已删除流程连接。");
  }, []);

  const arrangeCanvas = useCallback(() => {
    setCanvas((prev) => ({
      ...prev,
      nodes: arrangeCanvasNodes(prev),
      updatedAt: new Date().toISOString(),
    }));
    setPan({ x: 0, y: 0 });
    setNotice("已按流程层级整理画布：入口在左，分支上下展开，汇聚节点靠后。线和配置未改变。");
  }, []);

  const handleTemplateClick = useCallback((event: React.MouseEvent<HTMLButtonElement>, template: NodeTemplate) => {
    event.stopPropagation();
    addNode(template);
  }, [addNode]);

  // 更新节点位置
  const updateNodePosition = useCallback((nodeId: string, position: NodePosition) => {
    setCanvas((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
    }));
  }, []);

  // 开始拖拽节点
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const node = canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    setDraggingNode(nodeId);
    setSelectedNode(nodeId);
    setDragOffset({
      x: e.clientX - pan.x - node.position.x * zoom,
      y: e.clientY - pan.y - node.position.y * zoom,
    });
  }, [canvas.nodes, pan.x, pan.y, zoom]);

  // 拖拽节点移动
  useEffect(() => {
    if (!draggingNode) return;
    let frameId: number | null = null;
    let pendingPosition: NodePosition | null = null;

    const flushPosition = () => {
      frameId = null;
      if (!pendingPosition) return;
      const nextPosition = pendingPosition;
      pendingPosition = null;
      updateNodePosition(draggingNode, nextPosition);
    };

    const handleMouseMove = (e: MouseEvent) => {
      const newX = (e.clientX - pan.x - dragOffset.x) / zoom;
      const newY = (e.clientY - pan.y - dragOffset.y) / zoom;
      pendingPosition = { x: newX, y: newY };
      if (frameId === null) {
        frameId = window.requestAnimationFrame(flushPosition);
      }
    };

    const handleMouseUp = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (pendingPosition) {
        updateNodePosition(draggingNode, pendingPosition);
        pendingPosition = null;
      }
      setCanvas((prev) => ({ ...prev, updatedAt: new Date().toISOString() }));
      setDraggingNode(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingNode, dragOffset, pan.x, pan.y, zoom, updateNodePosition]);

  // 画布平移
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || isCanvasPanBlocked(e.target)) return;
    e.preventDefault();
    setConnectionDraft(null);
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  useEffect(() => {
    if (!isPanning) return;
    let frameId: number | null = null;
    let pendingPan: NodePosition | null = null;

    const flushPan = () => {
      frameId = null;
      if (!pendingPan) return;
      const nextPan = pendingPan;
      pendingPan = null;
      setPan(nextPan);
    };

    const handleMouseMove = (e: MouseEvent) => {
      pendingPan = {
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      };
      if (frameId === null) {
        frameId = window.requestAnimationFrame(flushPan);
      }
    };

    const handleMouseUp = () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (pendingPan) {
        setPan(pendingPan);
        pendingPan = null;
      }
      setIsPanning(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning, panStart]);

  // AI 生成工作流
  const handleAIGenerateWorkflow = useCallback((nodes: WorkflowNode[], connections: NodeConnection[] = []) => {
    const generatedConnections = connections.length ? connections : connectSequentialNodes([], nodes);
    setCanvas((prev) => ({
      ...prev,
      nodes: [...prev.nodes, ...nodes],
      connections: [...prev.connections, ...connectSequentialNodes(prev.nodes, nodes.slice(0, 1)), ...generatedConnections],
      updatedAt: new Date().toISOString(),
    }));
    if (nodes[0]) {
      setSelectedNode(nodes[0].id);
    }
    setNotice(`AI 已生成 ${nodes.length} 个节点和 ${generatedConnections.length} 条流程线。`);
    // 自动关闭 AI 助手面板，让用户看到生成的节点
    setShowAIAssistant(false);
  }, []);

  return (
    <div className="inspiration-canvas-panel">
      {/* 顶部工具栏 */}
      <div className="canvas-toolbar">
        <div className="canvas-toolbar-left">
          <Sparkles size={20} />
          <div>
            <strong>灵感</strong>
            <small>从想法生成流程，整理后送入秩序执行</small>
          </div>
        </div>
        <div className="canvas-toolbar-actions">
          <button className="secondary-button compact" onClick={() => setShowAIAssistant(!showAIAssistant)}>
            <Bot size={16} />
            <span>{showAIAssistant ? "隐藏" : "显示"} AI 助手</span>
          </button>
          <button className="secondary-button compact" onClick={() => setShowNodeLibrary(!showNodeLibrary)}>
            <Grid3x3 size={16} />
            <span>{showNodeLibrary ? "隐藏" : "显示"}节点库</span>
          </button>
          <button className="secondary-button compact" onClick={arrangeCanvas} disabled={!canvas.nodes.length}>
            <AlignHorizontalSpaceAround size={16} />
            <span>整理布局</span>
          </button>
        </div>
      </div>

      <div className="canvas-flow-strip" role="status" aria-live="polite">
        <span className={canvas.nodes.length ? "done" : "active"}><Sparkles size={14} />构思</span>
        <span className={canvas.nodes.length ? flowIssue ? "warning" : "done" : ""}><Grid3x3 size={14} />编排 {canvas.nodes.length} 个节点 / {canvas.connections.length} 条线</span>
        <span className={!flowIssue && canvas.nodes.length ? "active" : ""}><Workflow size={14} />送入秩序</span>
        {canvas.nodes.length > 0 && <span className={flowSummary.entryLabels.length === 1 ? "done" : "warning"}><GitBranch size={14} />入口 {flowSummary.entryLabels.length || 0}</span>}
        {canvas.nodes.length > 0 && <span className={flowSummary.exitLabels.length ? "done" : "warning"}><Workflow size={14} />出口 {flowSummary.exitLabels.length || 0}</span>}
        <p>{notice}</p>
      </div>

      <div className="canvas-workspace">
        {/* 左侧节点库 */}
        {showNodeLibrary && (
          <aside className="canvas-node-library">
            <h3>节点库</h3>
            {nodeLibraryGroups.flatMap((group) => {
              const templates = nodeTemplates.filter((template) => template.category === group.category);
              if (!templates.length) return [];
              return [
                <div className="node-category" key={group.category}>
                  <h4>{group.title}</h4>
                  <div className="node-template-list">
                    {templates.map((template) => (
                      <button
                        key={template.type}
                        data-node-template={template.type}
                        className="node-template-item"
                        onClick={(event) => handleTemplateClick(event, template)}
                        title={template.description}
                      >
                        <span className="node-template-icon">{template.icon}</span>
                        <span className="node-template-label">{template.label}</span>
                      </button>
                    ))}
                  </div>
                </div>,
              ];
            })}
          </aside>
        )}

        {/* AI 助手面板 */}
        {showAIAssistant && (
          <div className="canvas-ai-drawer">
            <AIWorkflowAssistant onGenerateWorkflow={handleAIGenerateWorkflow} />
          </div>
        )}

        {/* 画布区域 */}
        <div
          ref={canvasRef}
          className={`canvas-area ${isPanning ? "is-panning" : ""}`}
          onMouseDown={handleCanvasMouseDown}
          style={{
            cursor: isPanning ? "grabbing" : "grab",
          }}
        >
          <div
            className="canvas-content"
            style={{
              width: canvasBounds.width,
              height: canvasBounds.height,
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            <svg className="canvas-connection-layer" aria-label="画布流程连线" width={canvasBounds.width} height={canvasBounds.height} viewBox={`0 0 ${canvasBounds.width} ${canvasBounds.height}`}>
              <defs>
                <marker id="canvas-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" />
                </marker>
              </defs>
              {canvas.connections.map((connection) => {
                const source = canvas.nodes.find((node) => node.id === connection.sourceNodeId);
                const target = canvas.nodes.find((node) => node.id === connection.targetNodeId);
                if (!source || !target) return null;
                const path = connectionPath(source, target, connection);
                return (
                  <g key={connection.id} className="canvas-connection-group">
                    <path className="canvas-connection-path" d={path} markerEnd="url(#canvas-arrow)" onClick={() => deleteConnection(connection.id)} />
                  </g>
                );
              })}
            </svg>
            {/* 渲染节点 */}
            {canvas.nodes.map((node) => {
              const template = getNodeTemplate(node.type);
              const nodeStatus = flowDiagnostic.nodeStatuses.get(node.id) ?? "isolated";
              return (
                <div
                  key={node.id}
                  className={`canvas-node ${selectedNode === node.id ? "selected" : ""} ${draggingNode === node.id ? "dragging" : ""} status-${nodeStatus}`}
                  style={{
                    left: node.position.x,
                    top: node.position.y,
                    borderColor: template?.color || "#65706b",
                  }}
                  onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                >
                  <div className="canvas-node-header" style={{ background: template?.color || "#65706b" }}>
                    <span className="canvas-node-icon">{template?.icon || "📦"}</span>
                    <span className="canvas-node-label">{node.label}</span>
                    <span className="canvas-node-status">{canvasNodeStatusLabel(nodeStatus)}</span>
                    <button
                      className="canvas-node-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteNode(node.id);
                      }}
                    >
                      ×
                    </button>
                  </div>
                  <div className="canvas-node-body">
                    {node.inputs.length > 0 && (
                      <div className="canvas-node-ports canvas-node-inputs">
                        {node.inputs.map((input) => (
                          <div key={input} className="canvas-node-port" title={input}>
                            <button className="canvas-node-port-dot input" type="button" aria-label={`连接到 ${node.label} 的 ${input}`} onClick={(event) => completeConnection(event, node.id, input)} />
                            <span>{input}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {node.outputs.length > 0 && (
                      <div className="canvas-node-ports canvas-node-outputs">
                        {node.outputs.map((output) => (
                          <div key={output} className="canvas-node-port" title={output}>
                            <span>{output}</span>
                            <button className={`canvas-node-port-dot output ${connectionDraft?.nodeId === node.id && connectionDraft.handle === output ? "active" : ""}`} type="button" aria-label={`从 ${node.label} 的 ${output} 开始连接`} onClick={(event) => startConnection(event, node.id, output)} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            <div className="canvas-connection-label-layer" aria-label="画布流程连线标签">
              {canvas.connections.map((connection) => {
                const source = canvas.nodes.find((node) => node.id === connection.sourceNodeId);
                const target = canvas.nodes.find((node) => node.id === connection.targetNodeId);
                if (!source || !target) return null;
                const label = connectionLabelPosition(source, target, connection);
                return (
                  <button
                    key={connection.id}
                    className="canvas-connection-label"
                    type="button"
                    title="点击删除这条流程线"
                    aria-label={`删除连线：${source.label} ${connection.sourceHandle || "output"} 到 ${target.label} ${connection.targetHandle || "input"}`}
                    style={{ left: label.x, top: label.y, width: label.width }}
                    onClick={() => deleteConnection(connection.id)}
                  >
                    <span>{connection.sourceHandle || "output"}</span>
                    <i>→</i>
                    <span>{connection.targetHandle || "input"}</span>
                  </button>
                );
              })}
            </div>

            {/* 空状态提示 */}
            {canvas.nodes.length === 0 && (
              <div className="canvas-empty-state">
                <Sparkles size={48} />
                <strong>开始创建你的 AI 工作流</strong>
                <p>打开 AI 助手自动生成流程，或从节点库添加第一个节点。</p>
                <button className="primary-action" onClick={() => setShowAIAssistant(true)}>
                  <Bot size={18} />
                  <span>用 AI 生成</span>
                </button>
                <button className="secondary-button" onClick={() => addNode(nodeTemplates[0])}>
                  <Plus size={18} />
                  <span>添加第一个节点</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function autoConnection(source: WorkflowNode, target: WorkflowNode, sourceHandle?: string, targetHandle?: string): NodeConnection {
  return {
    id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    sourceNodeId: source.id,
    sourceHandle: sourceHandle && source.outputs.includes(sourceHandle) ? sourceHandle : source.outputs[0] || "output",
    targetNodeId: target.id,
    targetHandle: targetHandle && target.inputs.includes(targetHandle) ? targetHandle : target.inputs[0] || "input",
  };
}

function createCanvasNode(template: NodeTemplate, nodeIndex: number, position?: NodePosition): WorkflowNode {
  return {
    id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    type: template.type,
    label: template.label,
    position: position || {
      x: 120 + (nodeIndex % 3) * 280,
      y: 110 + Math.floor(nodeIndex / 3) * 170,
    },
    config: { ...template.defaultConfig },
    runtime: template.runtime ? { ...template.runtime } : undefined,
    inputs: [...template.inputs],
    outputs: [...template.outputs],
  };
}

function connectSequentialNodes(existingNodes: WorkflowNode[], newNodes: WorkflowNode[]): NodeConnection[] {
  const sequence = [...existingNodes.slice(-1), ...newNodes].filter(Boolean);
  const connections: NodeConnection[] = [];
  for (let index = 0; index < sequence.length - 1; index += 1) {
    connections.push(autoConnection(sequence[index], sequence[index + 1]));
  }
  return connections;
}

function orderedNodesByPosition(nodes: WorkflowNode[]) {
  return [...nodes].sort((first, second) => first.position.x === second.position.x ? first.position.y - second.position.y : first.position.x - second.position.x);
}

function arrangeCanvasNodes(canvas: WorkflowCanvas) {
  if (!canvas.nodes.length) return canvas.nodes;
  if (!canvas.connections.length || hasCycle(canvas.nodes, canvas.connections)) {
    return orderedNodesByPosition(canvas.nodes).map((node, index) => ({
      ...node,
      position: {
        x: 120 + (index % 3) * 320,
        y: 110 + Math.floor(index / 3) * 190,
      },
    }));
  }
  const orderedNodes = orderedCanvasNodes(canvas);
  const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));
  const incoming = new Map(canvas.nodes.map((node) => [node.id, [] as string[]]));
  canvas.connections.forEach((connection) => {
    if (!nodeById.has(connection.sourceNodeId) || !nodeById.has(connection.targetNodeId)) return;
    incoming.set(connection.targetNodeId, [...(incoming.get(connection.targetNodeId) ?? []), connection.sourceNodeId]);
  });
  const layerById = new Map<string, number>();
  orderedNodes.forEach((node) => {
    const parentLayers = (incoming.get(node.id) ?? []).map((sourceId) => layerById.get(sourceId) ?? 0);
    layerById.set(node.id, parentLayers.length ? Math.max(...parentLayers) + 1 : 0);
  });
  const layers = new Map<number, WorkflowNode[]>();
  orderedNodes.forEach((node) => {
    const layer = layerById.get(node.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), node]);
  });
  const positioned = new Map<string, NodePosition>();
  [...layers.entries()].forEach(([layer, nodes]) => {
    const totalHeight = (nodes.length - 1) * 180;
    nodes.forEach((node, index) => {
      positioned.set(node.id, {
        x: 120 + layer * 320,
        y: 160 - totalHeight / 2 + index * 180,
      });
    });
  });
  const minY = Math.min(...[...positioned.values()].map((position) => position.y));
  const yShift = minY < 80 ? 80 - minY : 0;
  return canvas.nodes.map((node) => ({
    ...node,
    position: positioned.has(node.id) ? {
      x: positioned.get(node.id)!.x,
      y: positioned.get(node.id)!.y + yShift,
    } : node.position,
  }));
}

function canvasContentBounds(nodes: WorkflowNode[]) {
  if (!nodes.length) return { width: 1800, height: 1200 };
  const maxX = Math.max(...nodes.map((node) => node.position.x + nodeWidth));
  const maxY = Math.max(...nodes.map((node) => node.position.y + nodeHeight(node) + 80));
  return {
    width: Math.max(1800, Math.ceil(maxX + 360)),
    height: Math.max(1200, Math.ceil(maxY + 260)),
  };
}

function nodeHeight(node: WorkflowNode) {
  const inputRows = node.inputs.length * nodePortRowHeight;
  const outputRows = node.outputs.length * nodePortRowHeight;
  const groupGap = node.inputs.length && node.outputs.length ? 10 : 0;
  return nodeHeaderHeight + 24 + Math.max(nodePortRowHeight, inputRows + outputRows + groupGap);
}

function diagnoseCanvasFlow(canvas: WorkflowCanvas) {
  const nodeStatuses = new Map<string, CanvasNodeStatus>();
  canvas.nodes.forEach((node) => nodeStatuses.set(node.id, canvas.nodes.length <= 1 ? "ready" : "isolated"));
  const emptyResult = (issue: string) => ({ issue, nodeStatuses });
  if (canvas.nodes.length <= 1) return { issue: "", nodeStatuses };
  if (canvas.connections.length === 0) return emptyResult("节点之间还没有线，不能算流程。");
  const nodeIds = new Set(canvas.nodes.map((node) => node.id));
  const validConnections = canvas.connections.filter((connection) => nodeIds.has(connection.sourceNodeId) && nodeIds.has(connection.targetNodeId) && connection.sourceNodeId !== connection.targetNodeId);
  if (validConnections.length === 0) return emptyResult("节点之间还没有有效连线，不能算流程。");
  const connectedNodeIds = new Set<string>();
  const outgoing = new Map<string, string[]>();
  validConnections.forEach((connection) => {
    connectedNodeIds.add(connection.sourceNodeId);
    connectedNodeIds.add(connection.targetNodeId);
  });
  validConnections.forEach((connection) => {
    outgoing.set(connection.sourceNodeId, [...(outgoing.get(connection.sourceNodeId) ?? []), connection.targetNodeId]);
  });
  const disconnected = canvas.nodes.find((node) => !connectedNodeIds.has(node.id));
  if (disconnected) return emptyResult(`“${disconnected.label}”还没有接入流程线。`);
  const targets = new Set(validConnections.map((connection) => connection.targetNodeId));
  const startNodes = canvas.nodes.filter((node) => !targets.has(node.id));
  startNodes.forEach((node) => nodeStatuses.set(node.id, "entry"));
  if (startNodes.length === 0) {
    canvas.nodes.forEach((node) => nodeStatuses.set(node.id, "cycle"));
    return emptyResult("检测到流程环路：没有明确入口。请断开回流线，让流程从一个入口开始。");
  }
  if (startNodes.length > 1) {
    startNodes.forEach((node) => nodeStatuses.set(node.id, "blocked"));
    return emptyResult(`检测到 ${startNodes.length} 个流程入口，请保留一个入口或把它们连成一个流程。`);
  }
  if (hasCycle(canvas.nodes, validConnections)) {
    canvas.nodes.forEach((node) => nodeStatuses.set(node.id, "cycle"));
    return emptyResult("检测到流程环路。秩序执行需要有向无环流程，请删除回流连接。");
  }
  const startNode = startNodes[0] ?? canvas.nodes[0];
  const visited = new Set<string>();
  const stack = [startNode.id];
  while (stack.length) {
    const nodeId = stack.pop();
    if (!nodeId || visited.has(nodeId)) continue;
    visited.add(nodeId);
    (outgoing.get(nodeId) ?? []).forEach((targetId) => stack.push(targetId));
  }
  const outgoingCounts = new Map<string, number>();
  validConnections.forEach((connection) => {
    outgoingCounts.set(connection.sourceNodeId, (outgoingCounts.get(connection.sourceNodeId) ?? 0) + 1);
  });
  visited.forEach((nodeId) => {
    if (startNodes.some((node) => node.id === nodeId)) return;
    nodeStatuses.set(nodeId, (outgoingCounts.get(nodeId) ?? 0) === 0 ? "exit" : "ready");
  });
  const unreachable = canvas.nodes.find((node) => !visited.has(node.id));
  if (unreachable) {
    nodeStatuses.set(unreachable.id, "blocked");
    return emptyResult(`“${unreachable.label}”不在同一条可达流程里。`);
  }
  return { issue: "", nodeStatuses };
}

function hasCycle(nodes: WorkflowNode[], connections: NodeConnection[]) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const outgoing = new Map(nodes.map((node) => [node.id, [] as string[]]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  connections.forEach((connection) => {
    if (!nodeIds.has(connection.sourceNodeId) || !nodeIds.has(connection.targetNodeId) || connection.sourceNodeId === connection.targetNodeId) return;
    const targets = outgoing.get(connection.sourceNodeId) ?? [];
    if (targets.includes(connection.targetNodeId)) return;
    outgoing.set(connection.sourceNodeId, [...targets, connection.targetNodeId]);
    indegree.set(connection.targetNodeId, (indegree.get(connection.targetNodeId) ?? 0) + 1);
  });
  const queue = nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id);
  let visitedCount = 0;
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    visitedCount += 1;
    (outgoing.get(nodeId) ?? []).forEach((targetId) => {
      indegree.set(targetId, Math.max(0, (indegree.get(targetId) ?? 0) - 1));
      if ((indegree.get(targetId) ?? 0) === 0) queue.push(targetId);
    });
  }
  return visitedCount !== nodes.length;
}

function canvasNodeStatusLabel(status: CanvasNodeStatus) {
  if (status === "entry") return "入口";
  if (status === "exit") return "出口";
  if (status === "ready") return "已接入";
  if (status === "cycle") return "环路";
  if (status === "blocked") return "阻断";
  return "未接入";
}

function connectionPath(source: WorkflowNode, target: WorkflowNode, connection: NodeConnection) {
  const start = nodePortAnchor(source, connection.sourceHandle, "output");
  const end = nodePortAnchor(target, connection.targetHandle, "input");
  const distance = Math.max(80, Math.abs(end.x - start.x) * 0.45);
  return `M ${start.x} ${start.y} C ${start.x + distance} ${start.y}, ${end.x - distance} ${end.y}, ${end.x} ${end.y}`;
}

function connectionLabelPosition(source: WorkflowNode, target: WorkflowNode, connection: NodeConnection) {
  const start = nodePortAnchor(source, connection.sourceHandle, "output");
  const end = nodePortAnchor(target, connection.targetHandle, "input");
  const width = Math.min(210, Math.max(130, (connection.sourceHandle.length + connection.targetHandle.length) * 7 + 38));
  return {
    x: (start.x + end.x) / 2 - width / 2,
    y: (start.y + end.y) / 2 - 15,
    width,
  };
}

function nodePortAnchor(node: WorkflowNode, handle: string, direction: "input" | "output") {
  const ports = direction === "input" ? node.inputs : node.outputs;
  const index = Math.max(0, ports.indexOf(handle));
  const inputRows = node.inputs.length * nodePortRowHeight;
  const outputOffset = node.inputs.length ? inputRows + 10 : 0;
  const yOffset = nodeHeaderHeight + 12 + (direction === "output" ? outputOffset : 0) + index * nodePortRowHeight + 6;
  return {
    x: direction === "output" ? node.position.x + nodeWidth : node.position.x,
    y: node.position.y + yOffset,
  };
}

function orderedCanvasNodes(canvas: WorkflowCanvas) {
  if (!canvas.connections.length) return canvas.nodes;
  const nodeById = new Map(canvas.nodes.map((node) => [node.id, node]));
  const outgoing = new Map(canvas.nodes.map((node) => [node.id, [] as string[]]));
  const indegree = new Map(canvas.nodes.map((node) => [node.id, 0]));
  canvas.connections.forEach((connection) => {
    if (!nodeById.has(connection.sourceNodeId) || !nodeById.has(connection.targetNodeId) || connection.sourceNodeId === connection.targetNodeId) return;
    const targets = outgoing.get(connection.sourceNodeId) ?? [];
    if (targets.includes(connection.targetNodeId)) return;
    outgoing.set(connection.sourceNodeId, [...targets, connection.targetNodeId]);
    indegree.set(connection.targetNodeId, (indegree.get(connection.targetNodeId) ?? 0) + 1);
  });
  const originalOrder = new Map(canvas.nodes.map((node, index) => [node.id, index]));
  const sortByOriginalOrder = (items: string[]) => items.sort((first, second) => (originalOrder.get(first) ?? 0) - (originalOrder.get(second) ?? 0));
  const queue = sortByOriginalOrder(canvas.nodes.filter((node) => (indegree.get(node.id) ?? 0) === 0).map((node) => node.id));
  const orderedIds: string[] = [];
  while (queue.length) {
    const nodeId = queue.shift();
    if (!nodeId) continue;
    orderedIds.push(nodeId);
    (outgoing.get(nodeId) ?? []).forEach((targetId) => {
      indegree.set(targetId, Math.max(0, (indegree.get(targetId) ?? 0) - 1));
      if ((indegree.get(targetId) ?? 0) === 0) {
        queue.push(targetId);
        sortByOriginalOrder(queue);
      }
    });
  }
  if (orderedIds.length !== canvas.nodes.length) return canvas.nodes;
  return orderedIds.flatMap((nodeId) => nodeById.get(nodeId) ?? []);
}

function summarizeCanvasFlow(canvas: WorkflowCanvas) {
  const nodeIds = new Set(canvas.nodes.map((node) => node.id));
  const validConnections = canvas.connections.filter((connection) => nodeIds.has(connection.sourceNodeId) && nodeIds.has(connection.targetNodeId) && connection.sourceNodeId !== connection.targetNodeId);
  const incomingCount = new Map(canvas.nodes.map((node) => [node.id, 0]));
  const outgoingCount = new Map(canvas.nodes.map((node) => [node.id, 0]));
  validConnections.forEach((connection) => {
    incomingCount.set(connection.targetNodeId, (incomingCount.get(connection.targetNodeId) ?? 0) + 1);
    outgoingCount.set(connection.sourceNodeId, (outgoingCount.get(connection.sourceNodeId) ?? 0) + 1);
  });
  return {
    entryLabels: canvas.nodes.filter((node) => (incomingCount.get(node.id) ?? 0) === 0).map((node) => node.label),
    exitLabels: canvas.nodes.filter((node) => (outgoingCount.get(node.id) ?? 0) === 0).map((node) => node.label),
  };
}

function isCanvasPanBlocked(target: EventTarget | null) {
  if (!(target instanceof Element)) return true;
  return Boolean(target.closest(".canvas-node, button, input, textarea, select, a, [role='button']"));
}

function loadCanvas(): WorkflowCanvas {
  try {
    const stored = localStorage.getItem(canvasStorageKey);
    if (stored) {
      return normalizeStoredCanvas(JSON.parse(stored));
    }
  } catch (error) {
    console.error("Failed to load canvas:", error);
  }

  return {
    id: `canvas_${Date.now()}`,
    name: "新工作流",
    description: "",
    nodes: [],
    connections: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function normalizeStoredCanvas(canvas: WorkflowCanvas): WorkflowCanvas {
  const nodes = canvas.nodes.map(withTemplateRuntime).filter((node) => legacyNodeType(node) !== "http-request");
  const removedNodeIds = new Set(canvas.nodes.filter((node) => legacyNodeType(node) === "http-request").map((node) => node.id));
  const preservedConnections = canvas.connections.filter((connection) => !removedNodeIds.has(connection.sourceNodeId) && !removedNodeIds.has(connection.targetNodeId));
  const bridgedConnections = bridgeRemovedNodes(canvas.nodes, canvas.connections, removedNodeIds, new Set(nodes.map((node) => node.id)));
  return {
    ...canvas,
    nodes,
    connections: dedupeConnections([...preservedConnections, ...bridgedConnections]),
  };
}

function withTemplateRuntime(node: WorkflowNode): WorkflowNode {
  const template = getNodeTemplate(node.type);
  if (!template?.runtime || node.runtime) return node;
  return { ...node, runtime: { ...template.runtime } };
}

function legacyNodeType(node: WorkflowNode) {
  return String((node as { type?: unknown }).type ?? "");
}

function bridgeRemovedNodes(nodes: WorkflowNode[], connections: NodeConnection[], removedNodeIds: Set<string>, liveNodeIds: Set<string>) {
  return nodes.flatMap((node) => {
    if (!removedNodeIds.has(node.id)) return [];
    const incoming = connections.filter((connection) => connection.targetNodeId === node.id && liveNodeIds.has(connection.sourceNodeId));
    const outgoing = connections.filter((connection) => connection.sourceNodeId === node.id && liveNodeIds.has(connection.targetNodeId));
    return incoming.flatMap((source) => outgoing.map((target) => ({
      id: `conn_${source.sourceNodeId}_${target.targetNodeId}_${Date.now()}`,
      sourceNodeId: source.sourceNodeId,
      sourceHandle: source.sourceHandle,
      targetNodeId: target.targetNodeId,
      targetHandle: target.targetHandle,
    })));
  });
}

function dedupeConnections(connections: NodeConnection[]) {
  const seen = new Set<string>();
  return connections.filter((connection) => {
    const key = `${connection.sourceNodeId}:${connection.sourceHandle}->${connection.targetNodeId}:${connection.targetHandle}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
