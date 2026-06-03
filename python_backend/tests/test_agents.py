from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_agent_catalog_reports_langgraph_runtime():
    response = client.get("/api/agents/catalog")
    assert response.status_code == 200
    data = response.json()
    assert data["graph_runtime"]["runtime"] == "langgraph"
    assert data["graph_runtime"]["available"] is True
    assert any(agent["id"] == "workflow-agent" for agent in data["agents"])


def test_create_agent_run_uses_frontend_contract():
    response = client.post(
        "/api/agents/runs",
        json={
            "template_id": "note-copy",
            "agent_id": "workflow-agent",
            "mcp_server_ids": [],
            "input": {"note": "整理这条笔记"},
            "source": "manual",
        },
    )
    assert response.status_code == 200
    run = response.json()
    assert run["status"] == "success"
    assert run["review_status"] == "pending"
    assert run["graph_steps"][-1] == "persist"
    assert [result["graph_step"] for result in run["node_results"]] == ["source", "transform", "copy"]


def test_stream_agent_run_returns_sse_events():
    response = client.post(
        "/api/agents/runs/stream",
        json={
            "template_id": "note-message",
            "agent_id": "workflow-agent",
            "mcp_server_ids": [],
            "input": {"note": "给联系人发摘要"},
            "source": "manual",
        },
    )
    assert response.status_code == 200
    assert "event: run.started" in response.text
    assert "event: node.finished" in response.text
    assert "event: run.finished" in response.text


def test_canvas_run_preserves_runtime_binding_in_node_output():
    response = client.post(
        "/api/agents/runs",
        json={
            "template_id": "canvas-workflow",
            "agent_id": "workflow-agent",
            "mcp_server_ids": [],
            "input": {"canvas": "测试画布"},
            "source": "inspiration",
            "canvas": {
                "nodes": [
                    {"id": "n1", "type": "trigger", "label": "手动触发", "config": {}, "runtime": {"kind": "local", "label": "手动触发"}},
                    {"id": "n2", "type": "send-message", "label": "发送消息", "config": {"recipient": "u1"}, "runtime": {"kind": "api", "label": "聊天模块：发送消息", "method": "POST", "path": "/api/chat/direct/:user_id"}},
                ],
                "connections": [{"id": "c1", "sourceNodeId": "n1", "sourceHandle": "开始", "targetNodeId": "n2", "targetHandle": "联系人"}],
            },
        },
    )
    assert response.status_code == 200
    run = response.json()
    assert run["node_results"][1]["type"] == "chat"
    assert "内部动作：聊天模块：发送消息" in run["node_results"][1]["output"]
