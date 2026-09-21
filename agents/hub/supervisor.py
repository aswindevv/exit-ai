"""Agent #1 -- Supervisor / orchestrator.

Top-level LangGraph whose nodes are the compiled subgraphs from Phase 6a
(exit_intel_agent, risk_agent) and Phase 6b (hr_agent, it_agent,
finance_agent). Holds one case state and walks it through the four stages in
order, with a conditional branch at the manager gate so a rejection routes to
escalation instead of crashing the run.

    entry -> hr -> manager_gate --[approved]--> it -> compliance -> finance -> assess -> END
                              `--[rejected]--> escalate -> END

`manager_gate` stands in for the frontend's (no-op, Phase 6b out of scope)
manager-approval button -- simulate_rejection plays the role a real click
would. Escalation doesn't loop back automatically: it logs the rejection as
a visible exit_tasks row for a human (HR) to act on, same "never
auto-execute past a human" posture as the IT agent's approval gate.

Run (from repo root, with agents/.venv active):
    python -m agents.hub.supervisor <case_id>
    python -m agents.hub.supervisor <case_id> --reject
"""
from __future__ import annotations

import sys

from langgraph.graph import END, StateGraph
from typing_extensions import TypedDict

from ..spokes import checklist_generator_agent, compliance_agent, finance_agent, it_deprovisioning_agent, kt_document_reviewer_agent, risk_agent
from ..spokes import multi_system_clearance, smart_routing
from ..core.config import db
from ..spokes.exit_intel_agent import run_per_case
from ..core.trace import log_db, traced_node


class SupervisorState(TypedDict):
    case_id: str
    kt_text: str | None
    interview_text: str | None
    simulate_rejection: bool
    log: list[str]


def _record(state: SupervisorState, stage: str, detail: str) -> None:
    """Append to state["log"] (already existed) AND persist a row so the HR
    dashboard's agent-activity view (B2) has something to read -- the
    terminal trace alone (B1) is stdout-only."""
    state["log"].append(detail)
    db.table("agent_runs").insert({"case_id": state["case_id"], "stage": stage, "detail": detail}).execute()
    log_db("insert", "agent_runs", rows=1, detail=detail)


def _activate(case_id: str) -> None:
    """Move a case off the default 'open' the moment orchestration starts, the
    same transition service.activate_case makes on the browser path. Without
    this a CLI-driven case stays 'open' on the HR dashboard even after a full
    successful run.

    Forward-only by construction: the .eq("status", "open") filter means an
    already-'in_progress' case is untouched and a 'completed' one can never be
    downgraded by a re-run. Deliberately does NOT set 'completed' -- that stays
    owned by the HR relieving-letter gate and e2e_automation._finalize, which
    only closes a case after compliance AND finance have actually cleared.
    """
    updated = db.table("exit_cases").update({"status": "in_progress"}) \
        .eq("id", case_id).eq("status", "open").execute().data
    if updated:
        log_db("update", "exit_cases", rows=1, detail="status -> in_progress")


@traced_node("Supervisor -- HR stage")
def _hr_stage(state: SupervisorState) -> SupervisorState:
    _activate(state["case_id"])
    checklist_generator_agent.generate(state["case_id"])
    if state.get("kt_text"):
        kt_document_reviewer_agent.review(state["case_id"], state["kt_text"])
    routing = smart_routing.pick_approver(state["case_id"], "hr")
    _record(state, "hr", "hr: checklist + kt-review done")
    _record(state, "hr", f"smart routing: {routing['reason']}")
    return state


@traced_node("Supervisor -- manager gate")
def _manager_gate(state: SupervisorState) -> SupervisorState:
    routing = smart_routing.pick_approver(state["case_id"], "manager")
    _record(state, "manager", f"smart routing: {routing['reason']}")
    _record(state, "manager", "rejected" if state["simulate_rejection"] else "approved")
    return state


def _route_after_manager(state: SupervisorState) -> str:
    return "rejected" if state["simulate_rejection"] else "approved"


@traced_node("Supervisor -- escalate")
def _escalate(state: SupervisorState) -> SupervisorState:
    db.table("exit_tasks").insert({
        "case_id": state["case_id"], "stage": "manager", "status": "pending",
        "title": "Escalated: manager rejected KT plan -- HR review needed",
        "escalation_state": "open",
    }).execute()
    log_db("insert", "exit_tasks", rows=1, detail="escalation")
    _record(state, "escalate", "escalated to HR, stopping short of IT/finance")
    return state


@traced_node("Supervisor -- IT stage")
def _it_stage(state: SupervisorState) -> SupervisorState:
    it_deprovisioning_agent.generate(state["case_id"])
    routing = smart_routing.pick_approver(state["case_id"], "it")
    _record(state, "it", "it: deprovisioning plan done")
    _record(state, "it", f"smart routing: {routing['reason']}")
    return state


@traced_node("Supervisor -- compliance stage")
def _compliance_stage(state: SupervisorState) -> SupervisorState:
    result = compliance_agent.run_for_case(state["case_id"])["result"]
    detail = "compliance: cleared" if result["cleared"] else f"compliance: blocked -- {result['blocking_reasons']}"
    _record(state, "compliance", detail)
    status = multi_system_clearance.consolidate(state["case_id"])
    _record(state, "compliance", f"multi-system clearance: {status['overall']} "
                                  f"(it={status['it_asset_management']['status']}, hrms={status['hrms']['status']}, "
                                  f"finance={status['finance']['status']})")
    return state


@traced_node("Supervisor -- finance stage")
def _finance_stage(state: SupervisorState) -> SupervisorState:
    finance_agent.check_clearance(state["case_id"])
    _record(state, "finance", "finance: clearance checked")
    return state


@traced_node("Supervisor -- assess")
def _assess_stage(state: SupervisorState) -> SupervisorState:
    if state.get("interview_text"):
        run_per_case(state["case_id"], state["interview_text"])
    risk_agent.run_for_case(state["case_id"])
    _record(state, "assess", "assess: risk scored")
    return state


_graph = StateGraph(SupervisorState)
_graph.add_node("hr", _hr_stage)
_graph.add_node("manager_gate", _manager_gate)
_graph.add_node("escalate", _escalate)
_graph.add_node("it", _it_stage)
_graph.add_node("compliance", _compliance_stage)
_graph.add_node("finance", _finance_stage)
_graph.add_node("assess", _assess_stage)

_graph.set_entry_point("hr")
_graph.add_edge("hr", "manager_gate")
_graph.add_conditional_edges("manager_gate", _route_after_manager, {"approved": "it", "rejected": "escalate"})
_graph.add_edge("it", "compliance")
_graph.add_edge("compliance", "finance")
_graph.add_edge("finance", "assess")
_graph.set_finish_point("assess")
_graph.add_edge("escalate", END)
supervisor_graph = _graph.compile()


def run_case(case_id: str, *, kt_text: str | None = None, interview_text: str | None = None,
             simulate_rejection: bool = False) -> dict:
    return supervisor_graph.invoke({
        "case_id": case_id,
        "kt_text": kt_text,
        "interview_text": interview_text,
        "simulate_rejection": simulate_rejection,
        "log": [],
    })


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    print(run_case(sys.argv[1], simulate_rejection="--reject" in sys.argv[2:]))
