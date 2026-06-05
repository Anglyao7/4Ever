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


def test_mcp_tools_use_backend_planned_mode_without_secret():
    response = client.get("/api/agents/mcp/bigmodel-web-search/tools")
    assert response.status_code == 200
    data = response.json()
    assert data["server_id"] == "bigmodel-web-search"
    assert data["status"] == "planned"
    assert data["tools"] == ["webSearchPrime"]
    assert data["configured"] is False
    assert "BIGMODEL_API_KEY" in data["reason"]


def test_mcp_tool_call_enforces_allowlist():
    response = client.post(
        "/api/agents/mcp/bigmodel-web-search/tools/call",
        json={"tool_name": "notAllowed", "arguments": {}},
    )
    assert response.status_code == 400


def test_agent_mcp_node_uses_python_mcp_client_planned_output():
    response = client.post(
        "/api/agents/runs",
        json={
            "template_id": "agent-research-brief",
            "agent_id": "research-agent",
            "mcp_server_ids": ["bigmodel-web-search", "bigmodel-web-reader"],
            "input": {"query": "https://example.com 研究一下"},
            "source": "manual",
        },
    )
    assert response.status_code == 200
    run = response.json()
    mcp_results = [result for result in run["node_results"] if result["type"] == "mcp"]
    assert len(mcp_results) == 2
    assert "Tool: webSearchPrime" in mcp_results[0]["output"]
    assert "Tool: webReader" in mcp_results[1]["output"]
    assert "计划调用 BigModel" in mcp_results[0]["output"]


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
