import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Save, Trash2, ZoomIn, ZoomOut, Grid3x3, Sparkles, Bot, Workflow } from "lucide-react";
import { nodeTemplates, getNodeTemplate } from "./lib/node-templates";
import AIWorkflowAssistant from "./AIWorkflowAssistant";
import type { WorkflowCanvas, WorkflowNode, NodePosition, NodeTemplate } from "./types/workflow-canvas";

const canvasStorageKey = "4ever.inspiration.canvas";
const workflowHandoffKey = "4ever.workflow.handoff";

export default function InspirationCanvasPanel() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvas, setCanvas] = useState<WorkflowCanvas>(loadCanvas);
  const [selectedNode, setSelectedNode] = useState<string | null>(null);
  const [draggingNode, setDraggingNode] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<NodePosition>({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState<NodePosition>({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<NodePosition>({ x: 0, y: 0 });
  const [showNodeLibrary, setShowNodeLibrary] = useState(true);
  const [showAIAssistant, setShowAIAssistant] = useState(false);
  const [notice, setNotice] = useState("先用 AI 助手生成流程，或从节点库手动添加节点。");

  // 保存画布到本地存储
  useEffect(() => {
    try {
      localStorage.setItem(canvasStorageKey, JSON.stringify(canvas));
    } catch (error) {
      console.error("Failed to save canvas:", error);
    }
  }, [canvas]);

  // 添加节点到画布
  const addNode = useCallback((template: NodeTemplate, position?: NodePosition) => {
    const nodeIndex = canvas.nodes.length;
    const nodePosition = position || {
      x: 120 + (nodeIndex % 3) * 280,
      y: 110 + Math.floor(nodeIndex / 3) * 170,
    };
    const newNode: WorkflowNode = {
      id: `node_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: template.type,
      label: template.label,
      position: nodePosition,
      config: { ...template.defaultConfig },
      inputs: [...template.inputs],
      outputs: [...template.outputs],
    };

    setCanvas((prev) => ({
      ...prev,
      nodes: [...prev.nodes, newNode],
      updatedAt: new Date().toISOString(),
    }));
    setSelectedNode(newNode.id);
    setNotice(`已新增节点：${newNode.label}`);
  }, [canvas.nodes.length]);

  // 删除节点
  const deleteNode = useCallback((nodeId: string) => {
    setCanvas((prev) => ({
      ...prev,
      nodes: prev.nodes.filter((n) => n.id !== nodeId),
      connections: prev.connections.filter((c) => c.sourceNodeId !== nodeId && c.targetNodeId !== nodeId),
      updatedAt: new Date().toISOString(),
    }));
    setSelectedNode(null);
    setNotice("已删除节点。");
  }, []);

  // 更新节点位置
  const updateNodePosition = useCallback((nodeId: string, position: NodePosition) => {
    setCanvas((prev) => ({
      ...prev,
      nodes: prev.nodes.map((n) => (n.id === nodeId ? { ...n, position } : n)),
      updatedAt: new Date().toISOString(),
    }));
  }, []);

  // 开始拖拽节点
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    const node = canvas.nodes.find((n) => n.id === nodeId);
    if (!node) return;

    setDraggingNode(nodeId);
    setSelectedNode(nodeId);
    setDragOffset({
      x: e.clientX - node.position.x * zoom,
      y: e.clientY - node.position.y * zoom,
    });
  }, [canvas.nodes, zoom]);

  // 拖拽节点移动
  useEffect(() => {
    if (!draggingNode) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = (e.clientX - dragOffset.x) / zoom;
      const newY = (e.clientY - dragOffset.y) / zoom;
      updateNodePosition(draggingNode, { x: newX, y: newY });
    };

    const handleMouseUp = () => {
      setDraggingNode(null);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [draggingNode, dragOffset, zoom, updateNodePosition]);

  // 画布平移
  const handleCanvasMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0 || e.target !== canvasRef.current) return;
    setIsPanning(true);
    setPanStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  }, [pan]);

  useEffect(() => {
    if (!isPanning) return;

    const handleMouseMove = (e: MouseEvent) => {
      setPan({
        x: e.clientX - panStart.x,
        y: e.clientY - panStart.y,
      });
    };

    const handleMouseUp = () => {
      setIsPanning(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isPanning, panStart]);

  // 保存到秩序模块
  const saveToWorkflow = useCallback(() => {
    if (canvas.nodes.length === 0) {
      setNotice("画布还没有节点，先生成或添加节点后再送入秩序。");
      return;
    }
    try {
      localStorage.setItem(workflowHandoffKey, JSON.stringify(canvasToWorkflowHandoff(canvas)));
      setNotice("已送入秩序，正在打开秩序模块。");
      window.history.pushState({}, "", "/automation");
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (error) {
      setNotice("送入秩序失败，请检查浏览器存储空间后再试。");
    }
  }, [canvas]);

  // 清空画布
  const clearCanvas = useCallback(() => {
    if (!confirm("确定要清空画布吗？")) return;
    setCanvas({
      id: `canvas_${Date.now()}`,
      name: "新工作流",
      description: "",
      nodes: [],
      connections: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    setSelectedNode(null);
    setNotice("画布已清空，可以重新开始。");
  }, []);

  // AI 生成工作流
  const handleAIGenerateWorkflow = useCallback((nodes: WorkflowNode[]) => {
    setCanvas((prev) => ({
      ...prev,
      nodes: [...prev.nodes, ...nodes],
      updatedAt: new Date().toISOString(),
    }));
    if (nodes[0]) {
      setSelectedNode(nodes[0].id);
    }
    setNotice(`AI 已生成 ${nodes.length} 个节点，可继续调整后送入秩序。`);
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
            <strong>灵感画布</strong>
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
          <button className="secondary-button compact" onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}>
            <ZoomOut size={16} />
          </button>
          <span className="zoom-indicator">{Math.round(zoom * 100)}%</span>
          <button className="secondary-button compact" onClick={() => setZoom(Math.min(2, zoom + 0.1))}>
            <ZoomIn size={16} />
          </button>
          <button className="secondary-button compact" onClick={clearCanvas}>
            <Trash2 size={16} />
            <span>清空</span>
          </button>
          <button className="primary-action compact" onClick={saveToWorkflow}>
            <Save size={16} />
            <span>保存到秩序</span>
          </button>
        </div>
      </div>

      <div className="canvas-flow-strip" role="status" aria-live="polite">
        <span className={canvas.nodes.length ? "done" : "active"}><Sparkles size={14} />构思</span>
        <span className={canvas.nodes.length ? "active" : ""}><Grid3x3 size={14} />编排 {canvas.nodes.length} 个节点</span>
        <span><Workflow size={14} />送入秩序</span>
        <p>{notice}</p>
      </div>

      <div className="canvas-workspace">
        {/* AI 助手面板 */}
        {showAIAssistant && (
          <AIWorkflowAssistant onGenerateWorkflow={handleAIGenerateWorkflow} />
        )}

        {/* 左侧节点库 */}
        {showNodeLibrary && (
          <aside className="canvas-node-library">
            <h3>节点库</h3>

            <div className="node-category">
              <h4>🎯 触发器</h4>
              <div className="node-template-list">
                {nodeTemplates.filter((t) => t.category === "trigger").map((template) => (
                  <button
                    key={template.type}
                    className="node-template-item"
                    onClick={() => addNode(template)}
                    title={template.description}
                  >
                    <span className="node-template-icon">{template.icon}</span>
                    <span className="node-template-label">{template.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="node-category">
              <h4>⚡ 动作</h4>
              <div className="node-template-list">
                {nodeTemplates.filter((t) => t.category === "action").map((template) => (
                  <button
                    key={template.type}
                    className="node-template-item"
                    onClick={() => addNode(template)}
                    title={template.description}
                  >
                    <span className="node-template-icon">{template.icon}</span>
                    <span className="node-template-label">{template.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="node-category">
              <h4>🔀 逻辑</h4>
              <div className="node-template-list">
                {nodeTemplates.filter((t) => t.category === "logic").map((template) => (
                  <button
                    key={template.type}
                    className="node-template-item"
                    onClick={() => addNode(template)}
                    title={template.description}
                  >
                    <span className="node-template-icon">{template.icon}</span>
                    <span className="node-template-label">{template.label}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="node-category">
              <h4>📊 数据</h4>
              <div className="node-template-list">
                {nodeTemplates.filter((t) => t.category === "data").map((template) => (
                  <button
                    key={template.type}
                    className="node-template-item"
                    onClick={() => addNode(template)}
                    title={template.description}
                  >
                    <span className="node-template-icon">{template.icon}</span>
                    <span className="node-template-label">{template.label}</span>
                  </button>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* 画布区域 */}
        <div
          ref={canvasRef}
          className="canvas-area"
          onMouseDown={handleCanvasMouseDown}
          style={{
            cursor: isPanning ? "grabbing" : "grab",
          }}
        >
          <div
            className="canvas-content"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: "0 0",
            }}
          >
            {/* 渲染节点 */}
            {canvas.nodes.map((node) => {
              const template = getNodeTemplate(node.type);
              return (
                <div
                  key={node.id}
                  className={`canvas-node ${selectedNode === node.id ? "selected" : ""}`}
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
                            <div className="canvas-node-port-dot" />
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
                            <div className="canvas-node-port-dot" />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

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

function canvasToWorkflowHandoff(canvas: WorkflowCanvas) {
  return {
    source: "inspiration",
    sourceId: canvas.id,
    noteId: "",
    title: canvas.name || "灵感画布工作流",
    content: renderCanvasSummary(canvas),
    mood: "灵感画布",
    stage: "growing",
    createdAt: new Date().toISOString(),
    canvas,
  };
}

function renderCanvasSummary(canvas: WorkflowCanvas) {
  const nodes = canvas.nodes.map((node, index) => {
    const configText = Object.entries(node.config ?? {})
      .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
      .map(([key, value]) => `${key}: ${String(value)}`)
      .join("; ");
    return `${index + 1}. ${node.label}（${node.type}）${configText ? ` - ${configText}` : ""}`;
  }).join("\n");
  const connections = canvas.connections.length
    ? canvas.connections.map((connection, index) => `${index + 1}. ${connection.sourceNodeId}:${connection.sourceHandle} -> ${connection.targetNodeId}:${connection.targetHandle}`).join("\n")
    : "暂无连接，按节点顺序执行。";
  return [`# ${canvas.name || "灵感画布工作流"}`, canvas.description, "## 节点", nodes, "## 连接", connections].filter(Boolean).join("\n\n");
}

function loadCanvas(): WorkflowCanvas {
  try {
    const stored = localStorage.getItem(canvasStorageKey);
    if (stored) {
      return JSON.parse(stored);
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
