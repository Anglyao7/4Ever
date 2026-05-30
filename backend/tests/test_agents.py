import asyncio
import os
import tempfile
import unittest

import httpx


db_file = tempfile.NamedTemporaryFile(prefix="4ever-agent-tests-", suffix=".db", delete=False)
db_file.close()
os.environ["DATABASE_URL"] = f"sqlite:///{db_file.name}"
os.environ.pop("BIGMODEL_API_KEY", None)
os.environ["BIGMODEL_MCP_LIVE"] = "0"
os.environ["AGENT_GRAPH_RUNTIME"] = "internal"

from fastapi.testclient import TestClient  # noqa: E402

from app.main import app  # noqa: E402
from app.schemas.agents import McpServer  # noqa: E402
from app.schemas.agents import AgentRunCreate  # noqa: E402
from app.schemas.ai import ChatCompletionResponse, ProviderFormat  # noqa: E402
from app.services.agents.active_runs import register_active_run, unregister_active_run  # noqa: E402
from app.services.agents.graph import AgentGraph, AgentGraphNode, build_agent_graph, build_canvas_agent_graph, graph_execution_nodes  # noqa: E402
from app.services.agents.langgraph_adapter import compile_langgraph_state_graph, execute_agent_graph_runtime, langgraph_plan, langgraph_runtime_status  # noqa: E402
from app.services.agents.mcp_client import call_mcp_tool, list_mcp_tools  # noqa: E402
from app.services.agents.runner import arguments_for_tool, execute_agent_workflow, prepare_agent_run, run_agent_workflow, tool_for_node  # noqa: E402
from app.services.agents.storage import cancel_agent_run  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402


def run_async(coro):
    return asyncio.run(coro)


class AgentApiTest(unittest.TestCase):
    def test_catalog_includes_workflow_policies(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/agents/catalog")

            self.assertEqual(response.status_code, 200)
            catalog = response.json()
            agents = {item["id"]: item for item in catalog["agents"]}
            self.assertEqual(agents["research-agent"]["prompt_version"], "research-v1")
            self.assertTrue(agents["research-agent"]["prompt_checksum"])
            self.assertIn("调研 Agent", agents["research-agent"]["system_prompt"])
            self.assertEqual(catalog["graph_runtime"]["runtime"], "internal")
            self.assertEqual(catalog["graph_runtime"]["requested"], "internal")
            self.assertFalse(catalog["graph_runtime"]["available"])
            policies = {item["id"]: item for item in catalog["workflow_templates"]}
            self.assertEqual(policies["agent-research-brief"]["execution_mode"], "read_only")
            self.assertFalse(policies["agent-research-brief"]["requires_review"])
            self.assertEqual(policies["agent-repo-brief"]["audit_level"], "code_evidence")
            self.assertIn("agent-repo-brief", agents["research-agent"]["workflow_template_ids"])
            self.assertIn("bigmodel-zread", agents["research-agent"]["mcp_server_ids"])
            self.assertTrue(policies["note-message"]["requires_review"])
            self.assertIn("draft_message", policies["note-message"]["side_effects"])

    def test_mcp_tools_endpoint_returns_safe_planned_tools(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/agents/mcp/bigmodel-web-search/tools")

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["server_id"], "bigmodel-web-search")
            self.assertEqual(payload["tool_name"], "tools/list")
            self.assertEqual(payload["status"], "planned")
            self.assertIn("webSearchPrime", payload["tools"])
            self.assertNotIn("BIGMODEL_API_KEY=", str(payload))

    def test_mcp_tools_endpoint_rejects_unknown_server(self) -> None:
        with TestClient(app) as client:
            response = client.get("/api/agents/mcp/unknown-server/tools")

            self.assertEqual(response.status_code, 404)

    def test_mcp_tool_call_endpoint_returns_safe_planned_result(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/mcp/bigmodel-zread/tools/call",
                json={
                    "tool_name": "get_repo_structure",
                    "arguments": {"repo": "openai/codex"},
                },
            )

            self.assertEqual(response.status_code, 200)
            payload = response.json()
            self.assertEqual(payload["server_id"], "bigmodel-zread")
            self.assertEqual(payload["tool_name"], "get_repo_structure")
            self.assertEqual(payload["status"], "planned")
            self.assertEqual(payload["arguments"], {"repo": "openai/codex"})
            self.assertNotIn("BIGMODEL_API_KEY=", str(payload))

    def test_mcp_tool_call_endpoint_rejects_unlisted_tool(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/mcp/bigmodel-zread/tools/call",
                json={"tool_name": "delete_repo", "arguments": {}},
            )

            self.assertEqual(response.status_code, 400)
            self.assertIn("allowlisted", response.json()["detail"])

    def test_module_directory_hides_admin_from_public_and_members(self) -> None:
        with TestClient(app) as client:
            public_response = client.get("/api/modules")
            self.assertEqual(public_response.status_code, 200)
            public_ids = {module["id"] for module in public_response.json()}
            self.assertIn("dashboard", public_ids)
            self.assertNotIn("admin", public_ids)

            auth = client.post(
                "/api/auth/sign-up",
                json={
                    "username": "modulemember",
                    "email": "modulemember@example.com",
                    "password": "member-password",
                    "display_name": "Module Member",
                },
            )
            self.assertEqual(auth.status_code, 200)
            member_response = client.get(
                "/api/modules",
                headers={"Authorization": f"Bearer {auth.json()['token']}"},
            )
            self.assertEqual(member_response.status_code, 200)
            member_ids = {module["id"] for module in member_response.json()}
            self.assertIn("dashboard", member_ids)
            self.assertNotIn("admin", member_ids)

    def test_module_directory_shows_admin_to_admin_users(self) -> None:
        with TestClient(app) as client:
            auth = client.post(
                "/api/auth/sign-up",
                json={
                    "username": "moduleadmin",
                    "email": "moduleadmin@example.com",
                    "password": "admin-password",
                    "display_name": "Module Admin",
                },
            )
            self.assertEqual(auth.status_code, 200)
            db = SessionLocal()
            try:
                from app.db.models import UserRecord

                user = db.get(UserRecord, auth.json()["user"]["id"])
                user.role = "admin"
                db.commit()
            finally:
                db.close()

            response = client.get(
                "/api/modules",
                headers={"Authorization": f"Bearer {auth.json()['token']}"},
            )
            self.assertEqual(response.status_code, 200)
            module_ids = {module["id"] for module in response.json()}
            self.assertIn("admin", module_ids)

    def test_admin_can_disable_mcp_server_policy(self) -> None:
        with TestClient(app) as client:
            auth = client.post(
                "/api/auth/sign-up",
                json={
                    "username": "mcpadmin",
                    "email": "mcpadmin@example.com",
                    "password": "admin-password",
                    "display_name": "MCP Admin",
                },
            )
            self.assertEqual(auth.status_code, 200)
            token = auth.json()["token"]
            headers = {"Authorization": f"Bearer {token}"}

            disabled = client.patch("/api/admin/mcp-servers/bigmodel-web-search", json={"enabled": False}, headers=headers)
            self.assertEqual(disabled.status_code, 200)
            self.assertFalse(disabled.json()["enabled"])

            catalog = client.get("/api/agents/catalog")
            self.assertEqual(catalog.status_code, 200)
            servers = {server["id"]: server for server in catalog.json()["mcp_servers"]}
            self.assertFalse(servers["bigmodel-web-search"]["enabled"])
            self.assertFalse(servers["bigmodel-web-search"]["live_enabled"])

            tools = client.get("/api/agents/mcp/bigmodel-web-search/tools")
            self.assertEqual(tools.status_code, 403)

            call = client.post(
                "/api/agents/mcp/bigmodel-web-search/tools/call",
                json={"tool_name": "webSearchPrime", "arguments": {"query": "blocked"}},
            )
            self.assertEqual(call.status_code, 403)

            run = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "agent-research-brief",
                    "agent_id": "research-agent",
                    "mcp_server_ids": ["bigmodel-web-search"],
                    "input": {"topic": "disabled mcp"},
                    "source": "test",
                },
            )
            self.assertEqual(run.status_code, 403)
            self.assertIn("disabled", run.json()["detail"])

            audit = client.get("/api/admin/audit-logs", headers=headers)
            self.assertEqual(audit.status_code, 200)
            self.assertIn("mcp.status.update", [item["action"] for item in audit.json()])

            enabled = client.patch("/api/admin/mcp-servers/bigmodel-web-search", json={"enabled": True}, headers=headers)
            self.assertEqual(enabled.status_code, 200)
            self.assertTrue(enabled.json()["enabled"])

    def test_admin_can_update_agent_prompt_metadata(self) -> None:
        try:
            with TestClient(app) as client:
                auth = client.post(
                    "/api/auth/sign-up",
                    json={
                        "username": "agentadmin",
                        "email": "agentadmin@example.com",
                        "password": "admin-password",
                        "display_name": "Agent Admin",
                    },
                )
                self.assertEqual(auth.status_code, 200)
                db = SessionLocal()
                try:
                    from app.db.models import UserRecord

                    user = db.get(UserRecord, auth.json()["user"]["id"])
                    user.role = "admin"
                    db.commit()
                finally:
                    db.close()
                headers = {"Authorization": f"Bearer {auth.json()['token']}"}

                agents = client.get("/api/admin/agents", headers=headers)
                self.assertEqual(agents.status_code, 200)
                original = {agent["id"]: agent for agent in agents.json()}["research-agent"]

                updated = client.patch(
                    "/api/admin/agents/research-agent",
                    headers=headers,
                    json={
                        "prompt_version": "research-admin-v2",
                        "system_prompt": "你是 4Ever 管理员调整后的调研 Agent。你必须保留证据来源，并明确区分事实与推测。",
                    },
                )
                self.assertEqual(updated.status_code, 200)
                self.assertEqual(updated.json()["prompt_version"], "research-admin-v2")
                self.assertNotEqual(updated.json()["prompt_checksum"], original["prompt_checksum"])

                catalog = client.get("/api/agents/catalog")
                self.assertEqual(catalog.status_code, 200)
                catalog_agent = {agent["id"]: agent for agent in catalog.json()["agents"]}["research-agent"]
                self.assertEqual(catalog_agent["prompt_version"], "research-admin-v2")
                self.assertIn("管理员调整", catalog_agent["system_prompt"])

                run = client.post(
                    "/api/agents/runs",
                    json={
                        "template_id": "agent-research-brief",
                        "agent_id": "research-agent",
                        "mcp_server_ids": [],
                        "input": {"topic": "prompt provenance"},
                        "source": "test",
                    },
                )
                self.assertEqual(run.status_code, 200)
                self.assertEqual(run.json()["agent_prompt_version"], "research-admin-v2")
                self.assertEqual(run.json()["agent_prompt_checksum"], catalog_agent["prompt_checksum"])

                audit = client.get("/api/admin/audit-logs", headers=headers)
                self.assertEqual(audit.status_code, 200)
                self.assertIn("agent.prompt.update", [item["action"] for item in audit.json()])
        finally:
            db = SessionLocal()
            try:
                from app.db.models import AgentPromptSettingRecord

                record = db.get(AgentPromptSettingRecord, "research-agent")
                if record:
                    db.delete(record)
                    db.commit()
            finally:
                db.close()

    def test_run_is_persisted_and_readable(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "agent-research-brief",
                    "agent_id": "research-agent",
                    "mcp_server_ids": ["bigmodel-web-search", "bigmodel-web-reader"],
                    "input": {"topic": "测试持久化 MCP 工作流 https://example.com"},
                    "source": "test",
                },
            )
            self.assertEqual(response.status_code, 200)
            run = response.json()
            self.assertTrue(run["thread_id"].startswith("thread-"))
            self.assertIn(run["thread_id"], run["checkpoint_id"])
            self.assertEqual(run["graph_steps"], ["load_agent", "mcp_search", "mcp_read", "synthesize", "persist"])
            self.assertEqual(run["node_results"][0]["graph_step"], "load_agent")
            self.assertEqual(run["agent_prompt_version"], "research-v1")
            self.assertTrue(run["agent_prompt_checksum"])
            self.assertEqual(run["node_results"][1]["graph_step"], "mcp_search")
            self.assertIn("Graph trace: load_agent", run["node_results"][0]["output"])

            detail = client.get(f"/api/agents/runs/{run['id']}")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["id"], run["id"])
            self.assertEqual(detail.json()["thread_id"], run["thread_id"])
            self.assertEqual(detail.json()["checkpoint_id"], run["checkpoint_id"])
            self.assertEqual(detail.json()["graph_steps"], run["graph_steps"])
            self.assertEqual(detail.json()["agent_prompt_version"], "research-v1")
            self.assertEqual(len(detail.json()["node_results"]), 4)
            self.assertEqual(detail.json()["node_results"][2]["graph_step"], "mcp_read")

            listing = client.get("/api/agents/runs?limit=10")
            self.assertEqual(listing.status_code, 200)
            self.assertIn(run["id"], [item["id"] for item in listing.json()["runs"]])

            events = client.get(f"/api/agents/runs/{run['id']}/events")
            self.assertEqual(events.status_code, 200)
            self.assertIn("text/event-stream", events.headers["content-type"])
            body = events.text
            self.assertIn("event: run.started", body)
            self.assertIn("event: node.finished", body)
            self.assertIn('"graph_step": "mcp_search"', body)
            self.assertIn("event: run.finished", body)

            checkpoints = client.get(f"/api/agents/runs/{run['id']}/checkpoints")
            self.assertEqual(checkpoints.status_code, 200)
            durable = checkpoints.json()["checkpoints"]
            self.assertEqual([item["graph_step"] for item in durable], ["load_agent", "mcp_search", "mcp_read", "synthesize"])
            self.assertTrue(all(item["checkpoint_id"].startswith(run["thread_id"]) for item in durable))
            self.assertEqual(durable[1]["state"]["trace"], ["load_agent", "mcp_search"])
            self.assertGreaterEqual(durable[1]["event_count"], 1)

            inspection = client.get(f"/api/agents/runs/{run['id']}/checkpoint")
            self.assertEqual(inspection.status_code, 200)
            langgraph = inspection.json()["langgraph"]
            self.assertEqual(langgraph["runtime"], "internal")
            self.assertEqual(langgraph["requested"], "internal")
            self.assertFalse(langgraph["available"])
            self.assertEqual(langgraph["checkpoint_count"], 0)
            self.assertFalse(langgraph["inspectable"])

    def test_stream_run_emits_progress_and_persists_run(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/runs/stream",
                json={
                    "template_id": "agent-research-brief",
                    "agent_id": "research-agent",
                    "mcp_server_ids": ["bigmodel-web-search"],
                    "input": {"topic": "streamed MCP workflow"},
                    "source": "test",
                },
            )

            self.assertEqual(response.status_code, 200)
            self.assertIn("text/event-stream", response.headers["content-type"])
            body = response.text
            self.assertIn("event: run.started", body)
            self.assertIn("event: node.finished", body)
            self.assertIn("event: run.finished", body)
            run_id = event_value(body, "run_id")
            detail = client.get(f"/api/agents/runs/{run_id}")
            self.assertEqual(detail.status_code, 200)
            self.assertEqual(detail.json()["id"], run_id)
            self.assertTrue(detail.json()["thread_id"].startswith("thread-"))
            self.assertIn("persist", detail.json()["graph_steps"])

    def test_retry_events_are_persisted_for_replay(self) -> None:
        import app.services.agents.runner as runner_module

        original_call_mcp_tool = runner_module.call_mcp_tool
        attempts = 0

        async def flaky_call(server, tool_name, arguments):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return {
                    "server_id": server.id,
                    "server_name": server.name,
                    "tool_name": tool_name,
                    "arguments": arguments,
                    "configured": True,
                    "live_enabled": True,
                    "status": "failed",
                    "error": "temporary replay outage",
                }
            return {
                "server_id": server.id,
                "server_name": server.name,
                "tool_name": tool_name,
                "arguments": arguments,
                "configured": True,
                "live_enabled": True,
                "status": "success",
                "result": {"content": [{"type": "text", "text": "ok"}]},
            }

        runner_module.call_mcp_tool = flaky_call
        try:
            with TestClient(app) as client:
                response = client.post(
                    "/api/agents/runs",
                    json={
                        "template_id": "agent-research-brief",
                        "agent_id": "research-agent",
                        "mcp_server_ids": ["bigmodel-web-search"],
                        "input": {"topic": "retry replay"},
                        "source": "test",
                    },
                )
                self.assertEqual(response.status_code, 200)
                run = response.json()

                events = client.get(f"/api/agents/runs/{run['id']}/events")
                self.assertEqual(events.status_code, 200)
                self.assertIn("event: node.retry", events.text)
                self.assertIn("temporary replay outage", events.text)
                self.assertIn("event: run.finished", events.text)
        finally:
            runner_module.call_mcp_tool = original_call_mcp_tool

    def test_run_validation_errors_are_not_persisted(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "note-copy",
                    "agent_id": "research-agent",
                    "mcp_server_ids": [],
                    "input": {"note": "not allowed"},
                },
            )
            self.assertEqual(response.status_code, 400)

    def test_review_required_run_can_be_approved(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "note-copy",
                    "agent_id": "workflow-agent",
                    "mcp_server_ids": [],
                    "input": {"note": "review me"},
                    "source": "test",
                },
            )
            self.assertEqual(response.status_code, 200)
            run = response.json()
            self.assertEqual(run["review_status"], "pending")

            review = client.patch(
                f"/api/agents/runs/{run['id']}/review",
                json={"status": "approved", "note": "looks good"},
            )

            self.assertEqual(review.status_code, 200)
            reviewed = review.json()
            self.assertEqual(reviewed["review_status"], "approved")
            self.assertEqual(reviewed["review_note"], "looks good")
            self.assertTrue(reviewed["reviewed_at"])

    def test_read_only_run_rejects_review_update(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "agent-research-brief",
                    "agent_id": "research-agent",
                    "mcp_server_ids": [],
                    "input": {"topic": "read only"},
                    "source": "test",
                },
            )
            self.assertEqual(response.status_code, 200)
            run = response.json()
            self.assertEqual(run["review_status"], "not_required")

            review = client.patch(f"/api/agents/runs/{run['id']}/review", json={"status": "approved"})

            self.assertEqual(review.status_code, 400)

    def test_cancel_endpoint_rejects_missing_and_finished_runs(self) -> None:
        with TestClient(app) as client:
            missing = client.post("/api/agents/runs/missing-run/cancel")
            self.assertEqual(missing.status_code, 404)

            response = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "note-copy",
                    "agent_id": "workflow-agent",
                    "mcp_server_ids": [],
                    "input": {"note": "already finished"},
                    "source": "test",
                },
            )
            self.assertEqual(response.status_code, 200)
            run = response.json()

            cancel = client.post(f"/api/agents/runs/{run['id']}/cancel")
            self.assertEqual(cancel.status_code, 409)
            self.assertIn("already", cancel.json()["detail"])

    def test_cancel_storage_marks_running_run_and_persists_event(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "note-copy",
                    "agent_id": "workflow-agent",
                    "mcp_server_ids": [],
                    "input": {"note": "cancel storage"},
                    "source": "test",
                },
            )
            self.assertEqual(response.status_code, 200)
            run = response.json()

        db = SessionLocal()
        try:
            from app.db.models import WorkflowAgentRunRecord

            record = db.get(WorkflowAgentRunRecord, run["id"])
            record.status = "running"
            db.commit()
            cancelled = cancel_agent_run(db, run["id"], "test cancellation")
            self.assertIsNotNone(cancelled)
            self.assertEqual(cancelled.status, "canceled")
        finally:
            db.close()

        with TestClient(app) as client:
            events = client.get(f"/api/agents/runs/{run['id']}/events")
            self.assertEqual(events.status_code, 200)
            self.assertIn("event: run.cancelled", events.text)
            self.assertIn("test cancellation", events.text)

    def test_cancel_endpoint_marks_running_run_and_replays_event(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "note-copy",
                    "agent_id": "workflow-agent",
                    "mcp_server_ids": [],
                    "input": {"note": "cancel through route"},
                    "source": "test",
                },
            )
            self.assertEqual(response.status_code, 200)
            run = response.json()

        db = SessionLocal()
        try:
            from app.db.models import WorkflowAgentRunRecord

            record = db.get(WorkflowAgentRunRecord, run["id"])
            record.status = "running"
            db.commit()
        finally:
            db.close()

        with TestClient(app) as client:
            cancel = client.post(f"/api/agents/runs/{run['id']}/cancel")
            self.assertEqual(cancel.status_code, 200)
            self.assertEqual(cancel.json()["status"], "canceled")

            events = client.get(f"/api/agents/runs/{run['id']}/events")
            self.assertEqual(events.status_code, 200)
            self.assertIn("event: run.cancelled", events.text)
            self.assertIn("cancelled by user", events.text)

    def test_resume_endpoint_rejects_finished_runs(self) -> None:
        with TestClient(app) as client:
            response = client.post(
                "/api/agents/runs",
                json={
                    "template_id": "note-copy",
                    "agent_id": "workflow-agent",
                    "mcp_server_ids": [],
                    "input": {"note": "already finished"},
                    "source": "test",
                },
            )
            self.assertEqual(response.status_code, 200)
            run = response.json()

            resume = client.post(f"/api/agents/runs/{run['id']}/resume")
            self.assertEqual(resume.status_code, 409)
            self.assertIn("only failed or canceled", resume.json()["detail"])

    def test_resume_endpoint_continues_after_last_successful_checkpoint(self) -> None:
        import app.services.agents.runner as runner_module

        original_call_mcp_tool = runner_module.call_mcp_tool
        attempts = 0

        async def fail_then_recover(server, tool_name, arguments):
            nonlocal attempts
            attempts += 1
            if attempts <= 2:
                return {
                    "server_id": server.id,
                    "server_name": server.name,
                    "tool_name": tool_name,
                    "arguments": arguments,
                    "configured": True,
                    "live_enabled": True,
                    "status": "failed",
                    "error": "resume outage",
                }
            return {
                "server_id": server.id,
                "server_name": server.name,
                "tool_name": tool_name,
                "arguments": arguments,
                "configured": True,
                "live_enabled": True,
                "status": "success",
                "result": {"content": [{"type": "text", "text": "resumed ok"}]},
            }

        runner_module.call_mcp_tool = fail_then_recover
        try:
            with TestClient(app) as client:
                failed = client.post(
                    "/api/agents/runs",
                    json={
                        "template_id": "agent-research-brief",
                        "agent_id": "research-agent",
                        "mcp_server_ids": ["bigmodel-web-search"],
                        "input": {"topic": "resume checkpoint"},
                        "source": "test",
                    },
                )
                self.assertEqual(failed.status_code, 200)
                failed_run = failed.json()
                self.assertEqual(failed_run["status"], "failed")
                self.assertEqual([node["graph_step"] for node in failed_run["node_results"]], ["load_agent", "mcp_search"])

                resumed = client.post(f"/api/agents/runs/{failed_run['id']}/resume")
                self.assertEqual(resumed.status_code, 200)
                resumed_run = resumed.json()
                self.assertEqual(resumed_run["thread_id"], failed_run["thread_id"])
                self.assertEqual(resumed_run["status"], "success")
                self.assertEqual(resumed_run["graph_steps"], ["load_agent", "mcp_search", "mcp_read", "synthesize", "persist"])
                self.assertEqual([node["graph_step"] for node in resumed_run["node_results"]], ["load_agent", "mcp_search", "mcp_read", "synthesize"])
                self.assertEqual(attempts, 4)

                events = client.get(f"/api/agents/runs/{resumed_run['id']}/events")
                self.assertEqual(events.status_code, 200)
                self.assertIn("event: run.resumed", events.text)
                self.assertIn('"resume_after": "load_agent"', events.text)

                checkpoint = client.get(f"/api/agents/runs/{failed_run['id']}/checkpoint")
                self.assertEqual(checkpoint.status_code, 200)
                inspection = checkpoint.json()
                self.assertTrue(inspection["resumable"])
                self.assertEqual(inspection["resume_after"], "load_agent")
                self.assertEqual(inspection["failed_step"], "mcp_search")
                self.assertEqual(inspection["completed_steps"], ["load_agent"])
                self.assertGreaterEqual(inspection["event_count"], 1)
                resumable_steps = [step for step in inspection["steps"] if step["resumable"]]
                self.assertEqual([step["graph_step"] for step in resumable_steps], ["load_agent"])

                checkpoints = client.get(f"/api/agents/runs/{failed_run['id']}/checkpoints")
                self.assertEqual(checkpoints.status_code, 200)
                durable = checkpoints.json()["checkpoints"]
                self.assertEqual([item["graph_step"] for item in durable], ["load_agent", "mcp_search"])
                self.assertEqual(durable[-1]["status"], "failed")
                self.assertEqual(durable[0]["state"]["resume_after"], "load_agent")
        finally:
            runner_module.call_mcp_tool = original_call_mcp_tool


class McpClientTest(unittest.IsolatedAsyncioTestCase):
    async def test_live_mcp_call_runs_streamable_http_lifecycle(self) -> None:
        import app.services.agents.mcp_client as mcp_client_module

        requests = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json_from_request(request)
            requests.append((request, payload))
            if payload.get("method") == "initialize":
                return httpx.Response(
                    200,
                    json={"jsonrpc": "2.0", "id": "initialize", "result": {"protocolVersion": "2025-06-18"}},
                    headers={"Mcp-Session-Id": "session-123"},
                )
            if payload.get("method") == "notifications/initialized":
                return httpx.Response(202, json={})
            if payload.get("method") == "tools/call":
                return httpx.Response(
                    200,
                    json={"jsonrpc": "2.0", "id": "tools/call", "result": {"content": [{"type": "text", "text": "ok"}]}},
                )
            return httpx.Response(400, json={"error": "unexpected"})

        original_create_client = mcp_client_module.create_mcp_client
        original_key = os.environ.get("BIGMODEL_API_KEY")
        os.environ["BIGMODEL_API_KEY"] = "test-live-key"
        mcp_client_module.create_mcp_client = lambda timeout_seconds: httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=timeout_seconds)
        try:
            result = await call_mcp_tool(live_server(), "webSearchPrime", {"query": "4Ever"})
        finally:
            mcp_client_module.create_mcp_client = original_create_client
            restore_env("BIGMODEL_API_KEY", original_key)

        self.assertEqual(result["status"], "success")
        self.assertEqual(result["result"]["content"][0]["text"], "ok")
        self.assertEqual([payload.get("method") for _, payload in requests], ["initialize", "notifications/initialized", "tools/call"])
        self.assertEqual(requests[2][0].headers["Mcp-Session-Id"], "session-123")
        self.assertEqual(requests[2][0].headers["Authorization"], "Bearer test-live-key")
        self.assertNotIn("test-live-key", str(result))

    async def test_live_mcp_tool_list_parses_sse_response(self) -> None:
        import app.services.agents.mcp_client as mcp_client_module

        def handler(request: httpx.Request) -> httpx.Response:
            payload = json_from_request(request)
            if payload.get("method") == "initialize":
                return httpx.Response(200, json={"jsonrpc": "2.0", "id": "initialize", "result": {}}, headers={"Mcp-Session-Id": "tools-session"})
            if payload.get("method") == "notifications/initialized":
                return httpx.Response(202, json={})
            if payload.get("method") == "tools/list":
                return httpx.Response(
                    200,
                    text='event: message\ndata: {"jsonrpc":"2.0","id":"tools/list","result":{"tools":[{"name":"webSearchPrime"},{"name":"webReader"}]}}\n\n',
                    headers={"content-type": "text/event-stream"},
                )
            return httpx.Response(400, json={"error": "unexpected"})

        original_create_client = mcp_client_module.create_mcp_client
        original_key = os.environ.get("BIGMODEL_API_KEY")
        os.environ["BIGMODEL_API_KEY"] = "test-live-key"
        mcp_client_module.create_mcp_client = lambda timeout_seconds: httpx.AsyncClient(transport=httpx.MockTransport(handler), timeout=timeout_seconds)
        try:
            result = await list_mcp_tools(live_server())
        finally:
            mcp_client_module.create_mcp_client = original_create_client
            restore_env("BIGMODEL_API_KEY", original_key)

        self.assertEqual(result["status"], "success")
        self.assertEqual([tool["name"] for tool in result["result"]["tools"]], ["webSearchPrime", "webReader"])

    async def test_mcp_call_stays_planned_when_live_mode_is_off(self) -> None:
        server = McpServer(
            id="bigmodel-web-search",
            name="BigModel Web Search Prime",
            description="Search",
            endpoint="https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
            required_env="BIGMODEL_API_KEY",
            configured=True,
            live_enabled=False,
            tool_count=1,
            tool_names=["webSearchPrime"],
            tags=["search"],
        )

        result = await call_mcp_tool(server, "webSearchPrime", {"query": "4Ever"})

        self.assertEqual(result["status"], "planned")
        self.assertEqual(result["tool_name"], "webSearchPrime")
        self.assertIn("BIGMODEL_MCP_LIVE", result["reason"])

    async def test_mcp_call_rejects_unlisted_tools(self) -> None:
        server = McpServer(
            id="bigmodel-web-search",
            name="BigModel Web Search Prime",
            description="Search",
            endpoint="https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
            required_env="BIGMODEL_API_KEY",
            configured=True,
            live_enabled=False,
            tool_count=1,
            tool_names=["webSearchPrime"],
            tags=["search"],
        )

        result = await call_mcp_tool(server, "unknownTool", {})

        self.assertEqual(result["status"], "planned")
        self.assertIn("allowlisted", result["reason"])


class AgentRunnerTest(unittest.IsolatedAsyncioTestCase):
    async def test_canvas_payload_builds_runtime_graph_from_connections(self) -> None:
        canvas = {
            "id": "canvas-test",
            "nodes": [
                {"id": "trigger", "type": "trigger", "label": "手动触发", "config": {}, "inputs": [], "outputs": ["output"]},
                {"id": "models", "type": "provider-models", "label": "获取模型列表", "config": {"provider": "openai"}, "inputs": ["api_config"], "outputs": ["models"]},
                {"id": "agent", "type": "agent-run", "label": "秩序 Agent", "config": {"agentId": "workflow-agent"}, "inputs": ["task"], "outputs": ["summary"]},
            ],
            "connections": [
                {"sourceNodeId": "trigger", "sourceHandle": "output", "targetNodeId": "models", "targetHandle": "api_config"},
                {"sourceNodeId": "models", "sourceHandle": "models", "targetNodeId": "agent", "targetHandle": "task"},
            ],
        }

        execution = await execute_agent_workflow(
            AgentRunCreate(
                template_id="note-copy",
                agent_id="workflow-agent",
                mcp_server_ids=[],
                input={"note": "从灵感画布进入秩序"},
                source="inspiration",
                canvas=canvas,
            )
        )

        self.assertEqual(execution.run.status, "success")
        self.assertEqual(execution.run.canvas, canvas)
        self.assertEqual([node.node_id for node in execution.run.node_results], ["canvas-trigger", "canvas-models", "canvas-agent"])
        self.assertEqual([node.graph_step for node in execution.run.node_results], ["canvas_1_trigger", "canvas_2_provider_models", "canvas_3_agent_run"])
        self.assertIn("Canvas node: 获取模型列表", execution.run.node_results[1].output)

    async def test_canvas_graph_preserves_connection_edges(self) -> None:
        canvas = {
            "nodes": [
                {"id": "a", "type": "trigger", "label": "开始"},
                {"id": "b", "type": "token-usage", "label": "Token 统计"},
                {"id": "c", "type": "memory-map", "label": "地图记忆"},
            ],
            "connections": [
                {"sourceNodeId": "a", "targetNodeId": "b"},
                {"sourceNodeId": "a", "targetNodeId": "c"},
            ],
        }

        graph = build_canvas_agent_graph("note-copy", canvas)

        self.assertIn(("canvas_1_trigger", "canvas_2_token_usage"), graph.edges)
        self.assertIn(("canvas_1_trigger", "canvas_3_memory_map"), graph.edges)
        self.assertNotIn(("canvas_2_token_usage", "canvas_3_memory_map"), graph.edges)

    async def test_internal_executor_uses_edge_topology_order(self) -> None:
        graph = AgentGraph(
            template_id="custom",
            nodes=[
                AgentGraphNode("second", "transform", "第二步", "second"),
                AgentGraphNode("first", "source", "第一步", "first"),
                AgentGraphNode("third", "ai", "第三步", "third"),
            ],
            edges=[("first", "second"), ("second", "third"), ("third", "persist")],
        )

        self.assertEqual([node.graph_step for node in graph_execution_nodes(graph)], ["first", "second", "third"])

    async def test_ai_node_uses_planned_synthesis_by_default(self) -> None:
        execution = await execute_agent_workflow(
            AgentRunCreate(
                template_id="note-copy",
                agent_id="workflow-agent",
                mcp_server_ids=[],
                input={"note": "需要整理成文案的内容"},
                source="test",
            )
        )

        self.assertEqual(execution.run.status, "success")
        self.assertIn("计划生成摘要", execution.run.node_results[-1].output)
        self.assertIn("AGENT_SYNTHESIS_LIVE", execution.run.node_results[-1].output)

    async def test_ai_node_can_use_backend_owned_model_synthesis(self) -> None:
        import app.services.agents.runner as runner_module

        original_get_settings = runner_module.get_settings
        original_complete_chat = runner_module.complete_chat

        class AgentSynthesisSettings:
            agent_synthesis_live = True
            agent_synthesis_provider = "openai"
            agent_synthesis_base_url = "https://example.test/v1"
            agent_synthesis_api_key = "server-only-key"
            agent_synthesis_model = "test-model"

        async def fake_complete_chat(request):
            self.assertEqual(request.provider, ProviderFormat.openai)
            self.assertEqual(request.api_key, "server-only-key")
            self.assertEqual(request.model, "test-model")
            return ChatCompletionResponse(provider=request.provider, model=request.model, content="后端模型摘要")

        runner_module.get_settings = lambda: AgentSynthesisSettings()
        runner_module.complete_chat = fake_complete_chat
        try:
            execution = await execute_agent_workflow(
                AgentRunCreate(
                    template_id="note-copy",
                    agent_id="workflow-agent",
                    mcp_server_ids=[],
                    input={"note": "模型生成输入"},
                    source="test",
                )
            )
        finally:
            runner_module.get_settings = original_get_settings
            runner_module.complete_chat = original_complete_chat

        self.assertEqual(execution.run.status, "success")
        self.assertIn("模型生成摘要", execution.run.node_results[-1].output)
        self.assertIn("后端模型摘要", execution.run.node_results[-1].output)
        self.assertNotIn("server-only-key", execution.run.node_results[-1].output)

    async def test_execute_agent_workflow_collects_runtime_events(self) -> None:
        seen_events = []

        execution = await execute_agent_workflow(
            AgentRunCreate(
                template_id="note-message",
                agent_id="workflow-agent",
                mcp_server_ids=[],
                input={"note": "runtime event test"},
                source="test",
            ),
            lambda record: seen_events.append(record),
        )

        self.assertEqual(execution.run.status, "success")
        self.assertEqual([record.event for record in seen_events], ["run.started", "node.finished", "node.finished", "run.finished"])
        self.assertEqual(seen_events[1].data["graph_step"], "read_input")
        self.assertEqual(seen_events[-1].data["run_id"], execution.run.id)

    async def test_execute_agent_workflow_stops_between_nodes_when_cancelled(self) -> None:
        request = AgentRunCreate(
            template_id="note-copy",
            agent_id="workflow-agent",
            mcp_server_ids=[],
            input={"note": "cancel between graph nodes"},
            source="test",
        )
        prepared = prepare_agent_run(request)
        cancel_event = register_active_run(prepared.run_id)
        seen_events = []

        def collect(record):
            seen_events.append(record)
            if record.event == "node.finished":
                cancel_event.set()

        try:
            execution = await execute_agent_workflow(request, collect, prepared=prepared)
        finally:
            unregister_active_run(prepared.run_id)

        self.assertEqual(execution.run.status, "canceled")
        self.assertEqual([node.graph_step for node in execution.run.node_results], ["read_input"])
        self.assertIn("run.cancelled", [record.event for record in seen_events])
        self.assertNotIn("run.finished", [record.event for record in seen_events])

    async def test_failed_live_mcp_node_marks_run_failed(self) -> None:
        import app.services.agents.runner as runner_module

        original_call_mcp_tool = runner_module.call_mcp_tool

        async def failed_call(server, tool_name, arguments):
            return {
                "server_id": server.id,
                "server_name": server.name,
                "tool_name": tool_name,
                "arguments": arguments,
                "configured": True,
                "live_enabled": True,
                "status": "failed",
                "error": "mock mcp outage",
            }

        runner_module.call_mcp_tool = failed_call
        try:
            run = await run_agent_workflow(
                AgentRunCreate(
                    template_id="agent-research-brief",
                    agent_id="research-agent",
                    mcp_server_ids=["bigmodel-web-search"],
                    input={"topic": "MCP failure propagation"},
                    source="test",
                )
            )
        finally:
            runner_module.call_mcp_tool = original_call_mcp_tool

        self.assertEqual(run.status, "failed")
        self.assertEqual(run.node_results[1].status, "failed")
        self.assertIn("mock mcp outage", run.node_results[1].output)

    async def test_repo_workflow_calls_zread_tools_in_graph_order(self) -> None:
        import app.services.agents.runner as runner_module

        original_call_mcp_tool = runner_module.call_mcp_tool
        calls = []

        async def record_call(server, tool_name, arguments):
            calls.append((server.id, tool_name, arguments))
            return {
                "server_id": server.id,
                "server_name": server.name,
                "tool_name": tool_name,
                "arguments": arguments,
                "configured": True,
                "live_enabled": True,
                "status": "success",
                "result": {"content": [{"type": "text", "text": f"{tool_name} ok"}]},
            }

        runner_module.call_mcp_tool = record_call
        try:
            run = await run_agent_workflow(
                AgentRunCreate(
                    template_id="agent-repo-brief",
                    agent_id="research-agent",
                    mcp_server_ids=["bigmodel-zread"],
                    input={"topic": "https://github.com/openai/codex path: docs/usage.md checkpointing"},
                    source="test",
                )
            )
        finally:
            runner_module.call_mcp_tool = original_call_mcp_tool

        self.assertEqual(run.status, "success")
        self.assertEqual(
            run.graph_steps,
            ["load_agent", "mcp_repo_search", "mcp_repo_structure", "mcp_read_file", "synthesize", "persist"],
        )
        self.assertEqual(
            [node.graph_step for node in run.node_results],
            ["load_agent", "mcp_repo_search", "mcp_repo_structure", "mcp_read_file", "synthesize"],
        )
        self.assertEqual([tool_name for _, tool_name, _ in calls], ["search_doc", "get_repo_structure", "read_file"])
        self.assertTrue(all(server_id == "bigmodel-zread" for server_id, _, _ in calls))
        self.assertEqual(calls[0][2], {"query": "https://github.com/openai/codex path: docs/usage.md checkpointing", "repo": "openai/codex"})
        self.assertEqual(calls[1][2], {"repo": "openai/codex"})
        self.assertEqual(calls[2][2], {"repo": "openai/codex", "file_path": "docs/usage.md"})

    async def test_policy_retry_retries_failed_node_once(self) -> None:
        import app.services.agents.runner as runner_module

        original_call_mcp_tool = runner_module.call_mcp_tool
        attempts = 0

        async def flaky_call(server, tool_name, arguments):
            nonlocal attempts
            attempts += 1
            if attempts == 1:
                return {
                    "server_id": server.id,
                    "server_name": server.name,
                    "tool_name": tool_name,
                    "arguments": arguments,
                    "configured": True,
                    "live_enabled": True,
                    "status": "failed",
                    "error": "temporary outage",
                }
            return {
                "server_id": server.id,
                "server_name": server.name,
                "tool_name": tool_name,
                "arguments": arguments,
                "configured": True,
                "live_enabled": True,
                "status": "success",
                "result": {"content": [{"type": "text", "text": "ok"}]},
            }

        runner_module.call_mcp_tool = flaky_call
        try:
            run = await run_agent_workflow(
                AgentRunCreate(
                    template_id="agent-research-brief",
                    agent_id="research-agent",
                    mcp_server_ids=["bigmodel-web-search"],
                    input={"topic": "retry policy"},
                    source="test",
                )
            )
        finally:
            runner_module.call_mcp_tool = original_call_mcp_tool

        self.assertEqual(attempts, 3)
        self.assertEqual(run.status, "success")
        self.assertEqual(run.node_results[1].status, "success")
        self.assertIn("Retried successfully", run.node_results[1].output)

    async def test_policy_retry_exhaustion_keeps_run_failed(self) -> None:
        import app.services.agents.runner as runner_module

        original_call_mcp_tool = runner_module.call_mcp_tool
        attempts = 0

        async def failed_call(server, tool_name, arguments):
            nonlocal attempts
            attempts += 1
            return {
                "server_id": server.id,
                "server_name": server.name,
                "tool_name": tool_name,
                "arguments": arguments,
                "configured": True,
                "live_enabled": True,
                "status": "failed",
                "error": "persistent outage",
            }

        runner_module.call_mcp_tool = failed_call
        try:
            run = await run_agent_workflow(
                AgentRunCreate(
                    template_id="agent-research-brief",
                    agent_id="research-agent",
                    mcp_server_ids=["bigmodel-web-search"],
                    input={"topic": "retry exhaustion"},
                    source="test",
                )
            )
        finally:
            runner_module.call_mcp_tool = original_call_mcp_tool

        self.assertEqual(attempts, 2)
        self.assertEqual(run.status, "failed")
        self.assertEqual(run.node_results[1].status, "failed")
        self.assertIn("Retry attempts exhausted", run.node_results[1].output)
        self.assertIn("persistent outage", run.node_results[1].output)


class LangGraphAdapterTest(unittest.TestCase):
    def runtime_with_requested(self, requested):
        import app.services.agents.langgraph_adapter as adapter_module

        original_get_settings = adapter_module.get_settings
        adapter_module.get_settings = lambda: type("SettingsStub", (), {"agent_graph_runtime": requested})()
        try:
            return adapter_module.langgraph_runtime_status()
        finally:
            adapter_module.get_settings = original_get_settings

    def test_langgraph_adapter_reports_internal_fallback_when_missing(self) -> None:
        status = langgraph_runtime_status()
        self.assertEqual(status.runtime, "internal")
        self.assertEqual(status.requested, "internal")
        self.assertFalse(status.available)
        self.assertIn("AGENT_GRAPH_RUNTIME=internal", status.reason)

    def test_langgraph_runtime_can_force_internal_executor(self) -> None:
        status = self.runtime_with_requested("internal")

        self.assertEqual(status.runtime, "internal")
        self.assertEqual(status.requested, "internal")
        self.assertFalse(status.available)
        self.assertEqual(status.reason, "AGENT_GRAPH_RUNTIME=internal")

    def test_langgraph_runtime_preserves_explicit_langgraph_request(self) -> None:
        status = self.runtime_with_requested("langgraph")

        self.assertEqual(status.runtime, "langgraph")
        self.assertEqual(status.requested, "langgraph")
        self.assertTrue(status.available)
        self.assertIn("checkpointer available", status.reason)

    def test_langgraph_runtime_normalizes_unknown_request_to_auto(self) -> None:
        status = self.runtime_with_requested("surprise")

        self.assertEqual(status.runtime, "langgraph")
        self.assertEqual(status.requested, "auto")
        self.assertTrue(status.available)

    def test_langgraph_plan_matches_internal_graph_contract(self) -> None:
        graph = build_agent_graph("agent-research-brief")
        plan = langgraph_plan(graph)

        self.assertEqual(plan["runtime"], "internal")
        self.assertEqual(plan["requested"], "internal")
        self.assertEqual(plan["nodes"], ["load_agent", "mcp_search", "mcp_read", "synthesize"])
        self.assertIn({"from": "synthesize", "to": "persist"}, plan["edges"])

    def test_repo_langgraph_plan_matches_zread_graph_contract(self) -> None:
        graph = build_agent_graph("agent-repo-brief")
        plan = langgraph_plan(graph)

        self.assertEqual(plan["nodes"], ["load_agent", "mcp_repo_search", "mcp_repo_structure", "mcp_read_file", "synthesize"])
        self.assertIn({"from": "mcp_repo_structure", "to": "mcp_read_file"}, plan["edges"])

    def test_compile_langgraph_state_graph_returns_none_when_internal_forced(self) -> None:
        import app.services.agents.langgraph_adapter as adapter_module

        graph = build_agent_graph("note-message")
        original_get_settings = adapter_module.get_settings
        adapter_module.get_settings = lambda: type("SettingsStub", (), {"agent_graph_runtime": "internal"})()
        try:
            compiled = compile_langgraph_state_graph(graph, lambda node: (lambda state: state))
        finally:
            adapter_module.get_settings = original_get_settings

        self.assertIsNone(compiled)

    def test_runtime_uses_compiled_langgraph_when_available(self) -> None:
        import app.services.agents.langgraph_adapter as adapter_module

        graph = build_agent_graph("note-message")
        events = []
        handled = []

        class FakeRuntime:
            available = True
            runtime = "langgraph"
            requested = "langgraph"
            reason = "test"

        class FakeCompiledGraph:
            def __init__(self, handlers):
                self.handlers = handlers

            async def ainvoke(self, state, config=None):
                for handler in self.handlers:
                    state = await handler(state)
                return state

        def fake_compile(compiled_graph, node_handler, checkpointer=None):
            return FakeCompiledGraph([node_handler(node) for node in compiled_graph.nodes])

        class FakeCheckpointerContext:
            async def __aenter__(self):
                return object()

            async def __aexit__(self, exc_type, exc, traceback):
                return False

        async def handler(node, index, state):
            handled.append((node.graph_step, index))
            return {
                "node_id": node.id,
                "type": node.type,
                "title": node.title,
                "status": "success",
                "output": node.graph_step,
                "started_at": "start",
                "ended_at": "end",
            }

        original_status = adapter_module.langgraph_runtime_status
        original_compile = adapter_module.compile_langgraph_state_graph
        original_checkpointer = adapter_module.create_langgraph_checkpointer
        adapter_module.langgraph_runtime_status = lambda: FakeRuntime()
        adapter_module.compile_langgraph_state_graph = fake_compile
        adapter_module.create_langgraph_checkpointer = lambda: FakeCheckpointerContext()
        try:
            results = run_async(
                execute_agent_graph_runtime(
                    graph,
                    {"run_id": "run-langgraph", "template_id": "note-message", "agent_id": "workflow-agent", "trace": [], "status": "running"},
                    handler,
                    lambda event, data: events.append((event, data)),
                )
            )
        finally:
            adapter_module.langgraph_runtime_status = original_status
            adapter_module.compile_langgraph_state_graph = original_compile
            adapter_module.create_langgraph_checkpointer = original_checkpointer

        self.assertEqual(handled, [("read_input", 0), ("synthesize", 1)])
        self.assertEqual([result["graph_step"] for result in results], ["read_input", "synthesize"])
        self.assertEqual(events[0][0], "run.started")
        self.assertEqual([event for event, _ in events].count("node.finished"), 2)

    def test_runtime_uses_real_langgraph_sqlite_checkpointer(self) -> None:
        import app.services.agents.langgraph_adapter as adapter_module

        graph = build_agent_graph("note-message")
        events = []
        checkpoint_file = tempfile.NamedTemporaryFile(prefix="4ever-langgraph-", suffix=".sqlite", delete=False)
        checkpoint_file.close()

        class LangGraphSettings:
            agent_graph_runtime = "langgraph"
            agent_langgraph_checkpoint_path = checkpoint_file.name
            base_dir = None

        async def handler(node, index, state):
            return {
                "node_id": node.id,
                "type": node.type,
                "title": node.title,
                "status": "success",
                "output": node.graph_step,
                "started_at": "start",
                "ended_at": "end",
            }

        original_get_settings = adapter_module.get_settings
        adapter_module.get_settings = lambda: LangGraphSettings()
        try:
            results = run_async(
                execute_agent_graph_runtime(
                    graph,
                    {"run_id": "run-real-langgraph", "thread_id": "thread-real-langgraph", "template_id": "note-message", "agent_id": "workflow-agent", "trace": [], "status": "running"},
                    handler,
                    lambda event, data: events.append((event, data)),
                )
            )
        finally:
            adapter_module.get_settings = original_get_settings

        self.assertEqual([result["graph_step"] for result in results], ["read_input", "synthesize"])
        self.assertEqual([event for event, _ in events].count("node.finished"), 2)
        self.assertTrue(os.path.exists(checkpoint_file.name))
        self.assertGreater(os.path.getsize(checkpoint_file.name), 0)

    def test_checkpoint_inspection_reads_langgraph_sqlite_summary(self) -> None:
        import app.services.agents.langgraph_adapter as adapter_module
        import app.services.agents.storage as storage_module

        checkpoint_file = tempfile.NamedTemporaryFile(prefix="4ever-langgraph-inspection-", suffix=".sqlite", delete=False)
        checkpoint_file.close()

        class LangGraphSettings:
            agent_graph_runtime = "langgraph"
            agent_langgraph_checkpoint_path = checkpoint_file.name
            base_dir = None

        original_adapter_get_settings = adapter_module.get_settings
        original_storage_status = storage_module.langgraph_runtime_status
        original_storage_path = storage_module.langgraph_checkpoint_path
        adapter_module.get_settings = lambda: LangGraphSettings()
        storage_module.langgraph_runtime_status = adapter_module.langgraph_runtime_status
        storage_module.langgraph_checkpoint_path = adapter_module.langgraph_checkpoint_path
        try:
            run = run_async(
                run_agent_workflow(
                    AgentRunCreate(
                        template_id="note-message",
                        agent_id="workflow-agent",
                        input={"note": "LangGraph sqlite inspection"},
                        source="test",
                    )
                )
            )
            db = SessionLocal()
            try:
                from app.services.agents.storage import save_agent_run

                save_agent_run(db, run)
                inspection = storage_module.inspect_agent_run_checkpoint(db, run.id)
            finally:
                db.close()
        finally:
            adapter_module.get_settings = original_adapter_get_settings
            storage_module.langgraph_runtime_status = original_storage_status
            storage_module.langgraph_checkpoint_path = original_storage_path

        self.assertIsNotNone(inspection)
        self.assertEqual(inspection.langgraph["runtime"], "langgraph")
        self.assertTrue(inspection.langgraph["available"])
        self.assertTrue(inspection.langgraph["inspectable"])
        self.assertEqual(inspection.langgraph["thread_id"], run.thread_id)
        self.assertGreaterEqual(inspection.langgraph["checkpoint_count"], 2)
        self.assertGreaterEqual(inspection.langgraph["write_count"], 1)
        self.assertTrue(inspection.langgraph["latest_checkpoint_id"])
        node_checkpoints = inspection.langgraph["node_checkpoints"]
        self.assertIn("read_input", node_checkpoints)
        self.assertIn("synthesize", node_checkpoints)
        self.assertNotIn("thread-", node_checkpoints["read_input"]["checkpoint_id"])
        self.assertEqual(inspection.steps[0].checkpoint_id, node_checkpoints["read_input"]["checkpoint_id"])
        self.assertNotIn("checkpoint", inspection.langgraph)
        self.assertNotIn("checkpoint_path", inspection.langgraph)

    def test_langgraph_resume_continues_from_official_checkpoint(self) -> None:
        import app.services.agents.langgraph_adapter as adapter_module
        import app.services.agents.storage as storage_module

        checkpoint_file = tempfile.NamedTemporaryFile(prefix="4ever-langgraph-resume-", suffix=".sqlite", delete=False)
        checkpoint_file.close()

        class LangGraphSettings:
            agent_graph_runtime = "langgraph"
            agent_langgraph_checkpoint_path = checkpoint_file.name
            base_dir = None

        original_adapter_get_settings = adapter_module.get_settings
        original_storage_status = storage_module.langgraph_runtime_status
        original_storage_path = storage_module.langgraph_checkpoint_path
        adapter_module.get_settings = lambda: LangGraphSettings()
        storage_module.langgraph_runtime_status = adapter_module.langgraph_runtime_status
        storage_module.langgraph_checkpoint_path = adapter_module.langgraph_checkpoint_path
        graph = build_agent_graph("agent-research-brief")
        first_events = []
        resumed_events = []
        handled = []

        async def first_handler(node, index, state):
            handled.append(("first", node.graph_step, state.get("run_id")))
            status = "failed" if node.graph_step == "mcp_search" else "success"
            return {
                "node_id": node.id,
                "type": node.type,
                "title": node.title,
                "status": status,
                "output": "outage" if status == "failed" else node.graph_step,
                "started_at": "start",
                "ended_at": "end",
            }

        async def resume_handler(node, index, state):
            handled.append(("resume", node.graph_step, state.get("run_id")))
            return {
                "node_id": node.id,
                "type": node.type,
                "title": node.title,
                "status": "success",
                "output": node.graph_step,
                "started_at": "start",
                "ended_at": "end",
            }

        try:
            first_state = {
                "run_id": "run-lg-first",
                "thread_id": "thread-lg-resume",
                "template_id": "agent-research-brief",
                "agent_id": "research-agent",
                "trace": [],
                "status": "running",
                "retry_limit": 0,
                "timeout_seconds": 30,
            }
            first_results = run_async(
                execute_agent_graph_runtime(
                    graph,
                    first_state,
                    first_handler,
                    lambda event, data: first_events.append((event, data)),
                )
            )
            resume_checkpoint_id = adapter_module.langgraph_checkpoint_for_step("thread-lg-resume", "load_agent")
            resumed_state = {
                "run_id": "run-lg-resumed",
                "thread_id": "thread-lg-resume",
                "template_id": "agent-research-brief",
                "agent_id": "research-agent",
                "trace": ["load_agent"],
                "status": "running",
                "retry_limit": 0,
                "timeout_seconds": 30,
                "resume_after": "load_agent",
                "langgraph_checkpoint_id": resume_checkpoint_id,
            }
            resumed_results = run_async(
                execute_agent_graph_runtime(
                    graph,
                    resumed_state,
                    resume_handler,
                    lambda event, data: resumed_events.append((event, data)),
                )
            )
        finally:
            adapter_module.get_settings = original_adapter_get_settings
            storage_module.langgraph_runtime_status = original_storage_status
            storage_module.langgraph_checkpoint_path = original_storage_path

        self.assertEqual([result["graph_step"] for result in first_results], ["load_agent", "mcp_search"])
        self.assertTrue(resume_checkpoint_id)
        self.assertEqual([result["graph_step"] for result in resumed_results], ["mcp_search", "mcp_read", "synthesize"])
        self.assertNotIn(("resume", "load_agent", "run-lg-resumed"), handled)
        self.assertIn(("resume", "mcp_search", "run-lg-resumed"), handled)
        self.assertEqual(resumed_state["trace"], ["load_agent", "mcp_search", "mcp_read", "synthesize", "persist"])
        self.assertIn(("run.resumed", {"run_id": "run-lg-resumed", "template_id": "agent-research-brief", "agent_id": "research-agent", "resume_after": "load_agent", "start_index": 0}), resumed_events)


class McpToolExtractionTest(unittest.TestCase):
    def test_extract_tool_names_from_live_result(self) -> None:
        from app.api.routes.agents import extract_tool_names

        names = extract_tool_names(
            {
                "status": "success",
                "result": {
                    "tools": [
                        {"name": "webSearchPrime", "description": "Search"},
                        {"name": "webReader", "description": "Read"},
                    ]
                },
            },
            ["fallback"],
        )

        self.assertEqual(names, ["webSearchPrime", "webReader"])

    def test_zread_tool_selection_and_arguments_cover_repo_tools(self) -> None:
        server = McpServer(
            id="bigmodel-zread",
            name="BigModel ZRead",
            description="Repo docs",
            endpoint="https://open.bigmodel.cn/api/mcp/zread/mcp",
            required_env="BIGMODEL_API_KEY",
            configured=False,
            live_enabled=False,
            tool_count=3,
            tool_names=["search_doc", "get_repo_structure", "read_file"],
            tags=["repo"],
        )

        self.assertEqual(tool_for_node("repo_structure", server), "get_repo_structure")
        self.assertEqual(tool_for_node("read_file", server), "read_file")
        self.assertEqual(tool_for_node("search_doc", server), "search_doc")
        self.assertEqual(tool_for_node("search", server), "search_doc")
        self.assertEqual(arguments_for_tool("search_doc", "openai/codex streaming api"), {"query": "openai/codex streaming api", "repo": "openai/codex"})
        self.assertEqual(arguments_for_tool("get_repo_structure", "https://github.com/openai/codex"), {"repo": "openai/codex"})
        self.assertEqual(arguments_for_tool("read_file", "repo openai/codex path: docs/usage.md"), {"repo": "openai/codex", "file_path": "docs/usage.md"})


class TokenUsageApiTest(unittest.TestCase):
    def test_token_usage_ingest_dashboard_and_leaderboard_bind_current_user(self) -> None:
        with TestClient(app) as client:
            auth = client.post(
                "/api/auth/sign-up",
                json={
                    "username": "tokenuser",
                    "email": "tokenuser@example.com",
                    "password": "token-password",
                    "display_name": "Token User",
                },
            )
            self.assertEqual(auth.status_code, 200)
            headers = {"Authorization": f"Bearer {auth.json()['token']}"}

            key_response = client.post("/api/token-usage/keys", json={"name": "Local CLI"}, headers=headers)
            self.assertEqual(key_response.status_code, 200)
            raw_key = key_response.json()["raw_key"]
            self.assertTrue(raw_key.startswith("4ev_tok_"))

            ingest = client.post(
                "/api/token-usage/ingest",
                headers={"Authorization": f"Bearer {raw_key}"},
                json={
                    "schemaVersion": 2,
                    "device": {"deviceId": "test-device", "hostname": "test-host"},
                    "buckets": [
                        {
                            "source": "codex",
                            "model": "gpt-5",
                            "projectKey": "project-hash",
                            "projectLabel": "4Ever",
                            "bucketStart": "2026-05-30T08:00:00Z",
                            "inputTokens": 100,
                            "outputTokens": 40,
                            "reasoningTokens": 30,
                            "cachedTokens": 10,
                        }
                    ],
                    "sessions": [
                        {
                            "source": "codex",
                            "projectKey": "project-hash",
                            "projectLabel": "4Ever",
                            "sessionHash": "session-one",
                            "firstMessageAt": "2026-05-30T08:00:00Z",
                            "lastMessageAt": "2026-05-30T08:08:00Z",
                            "durationSeconds": 480,
                            "activeSeconds": 120,
                            "messageCount": 4,
                            "userMessageCount": 2,
                            "inputTokens": 100,
                            "outputTokens": 40,
                            "reasoningTokens": 30,
                            "cachedTokens": 10,
                            "primaryModel": "gpt-5",
                            "modelUsages": [{"model": "gpt-5", "totalTokens": 180}],
                        }
                    ],
                },
            )
            self.assertEqual(ingest.status_code, 200)
            self.assertEqual(ingest.json()["bucketCount"], 1)
            self.assertEqual(ingest.json()["sessionCount"], 1)

            dashboard = client.get("/api/token-usage/dashboard?range=all", headers=headers)
            self.assertEqual(dashboard.status_code, 200)
            payload = dashboard.json()
            self.assertEqual(payload["overview"]["total_tokens"], 180)
            self.assertEqual(payload["overview"]["active_seconds"], 120)
            self.assertEqual(payload["overview"]["sessions"], 1)
            self.assertEqual(payload["by_source"][0]["key"], "codex")
            self.assertEqual(payload["by_model"][0]["key"], "gpt-5")
            self.assertEqual(payload["by_project"][0]["label"], "4Ever")
            self.assertEqual(payload["heatmap"][0]["hour"], 8)
            self.assertEqual(payload["devices"][0]["device_id"], "test-device")
            self.assertEqual(payload["devices"][0]["hostname"], "test-host")
            self.assertEqual(payload["devices"][0]["total_tokens"], 180)

            keys = client.get("/api/token-usage/keys", headers=headers)
            self.assertEqual(keys.status_code, 200)
            self.assertIsNotNone(keys.json()[0]["last_used_at"])

            leaderboard = client.get("/api/token-usage/leaderboard?range=all", headers=headers)
            self.assertEqual(leaderboard.status_code, 200)
            top = leaderboard.json()["entries"][0]
            self.assertEqual(top["username"], "tokenuser")
            self.assertEqual(top["total_tokens"], 180)
            self.assertEqual(top["active_seconds"], 120)


def live_server() -> McpServer:
    return McpServer(
        id="bigmodel-web-search",
        name="BigModel Web Search Prime",
        description="Search",
        endpoint="https://open.bigmodel.cn/api/mcp/web_search_prime/mcp",
        required_env="BIGMODEL_API_KEY",
        configured=True,
        live_enabled=True,
        tool_count=1,
        tool_names=["webSearchPrime", "webReader"],
        tags=["search"],
    )


def json_from_request(request: httpx.Request) -> dict:
    return json_loads(request.content.decode())


def json_loads(text: str) -> dict:
    import json

    return json.loads(text)


def event_value(body: str, key: str) -> str:
    marker = f'"{key}": '
    start = body.find(marker)
    if start == -1:
        return ""
    start += len(marker)
    quote = '"'
    if not body.startswith(quote, start):
        return ""
    start += 1
    end = body.find(quote, start)
    return body[start:end]


def restore_env(key: str, value: object) -> None:
    if value is None:
        os.environ.pop(key, None)
        return
    os.environ[key] = str(value)


if __name__ == "__main__":
    unittest.main()
