"""Behaviour tests for the acceptance verdict.

The verdict is the gate that decides whether a roadmap checkbox may flip, so
these tests focus on the ways a run could dishonestly earn an ACCEPTED.
"""
from __future__ import annotations

import pytest

from compute_acceptance_verdict import (
    ACCEPTED,
    ACCEPTED_WITH_CAVEATS,
    NOT_VALIDATED,
    REJECTED,
    MalformedEvidence,
    compute,
)


class TestGreenPaths:
    def test_todos_os_criterios_exercidos_com_evidencia_dao_accepted(
        self, criteria_m2: list[dict], passing_results: list[dict]
    ) -> None:
        outcome = compute(criteria_m2, passing_results, [])

        assert outcome["verdict"] == ACCEPTED
        assert outcome["flip_allowed"] is True

    def test_defeito_nao_bloqueante_da_accepted_with_caveats(
        self, criteria_m2: list[dict], passing_results: list[dict]
    ) -> None:
        defects = [{"severity": "minor", "summary": "spinner pisca", "issue": "#412"}]

        outcome = compute(criteria_m2, passing_results, defects)

        assert outcome["verdict"] == ACCEPTED_WITH_CAVEATS
        assert outcome["flip_allowed"] is True

    def test_caveat_sem_issue_aberta_fica_visivel_no_motivo(
        self, criteria_m2: list[dict], passing_results: list[dict]
    ) -> None:
        outcome = compute(criteria_m2, passing_results, [{"severity": "minor", "summary": "x"}])

        assert any("NO ISSUE FILED" in reason for reason in outcome["reasons"])


class TestRejected:
    def test_criterio_reprovado_no_sistema_vivo_da_rejected(
        self, criteria_m2: list[dict], passing_results: list[dict]
    ) -> None:
        results = [passing_results[0], {"id": "AC2", "status": "failed", "note": "levou 6s"}]

        outcome = compute(criteria_m2, results, [])

        assert outcome["verdict"] == REJECTED
        assert outcome["flip_allowed"] is False
        assert any("levou 6s" in reason for reason in outcome["reasons"])

    def test_defeito_blocker_reprova_mesmo_com_todos_os_criterios_verdes(
        self, criteria_m2: list[dict], passing_results: list[dict]
    ) -> None:
        defects = [{"severity": "blocker", "summary": "vaza sessão de outro usuário"}]

        outcome = compute(criteria_m2, passing_results, defects)

        assert outcome["verdict"] == REJECTED
        assert outcome["flip_allowed"] is False


class TestNotValidated:
    def test_passou_sem_evidencia_nao_e_passou(self, criteria_m2: list[dict]) -> None:
        results = [
            {"id": "AC1", "status": "passed", "evidence": ["evidence/ok.png"]},
            {"id": "AC2", "status": "passed", "evidence": []},
        ]

        outcome = compute(criteria_m2, results, [])

        assert outcome["verdict"] == NOT_VALIDATED
        assert any("asserted pass is not a pass" in reason for reason in outcome["reasons"])

    def test_evidencia_so_com_espacos_em_branco_nao_conta(self, criteria_m2: list[dict]) -> None:
        results = [
            {"id": "AC1", "status": "passed", "evidence": ["evidence/ok.png"]},
            {"id": "AC2", "status": "passed", "evidence": ["   "]},
        ]

        assert compute(criteria_m2, results, [])["verdict"] == NOT_VALIDATED

    def test_criterio_sem_resultado_registrado_nao_valida(
        self, criteria_m2: list[dict], passing_results: list[dict]
    ) -> None:
        outcome = compute(criteria_m2, passing_results[:1], [])

        assert outcome["verdict"] == NOT_VALIDATED
        assert any("AC2: no result recorded" in reason for reason in outcome["reasons"])

    @pytest.mark.parametrize("status", ["not_exercised", "blocked"])
    def test_criterio_nao_exercido_nao_valida(self, criteria_m2: list[dict], status: str) -> None:
        results = [
            {"id": "AC1", "status": "passed", "evidence": ["evidence/ok.png"]},
            {"id": "AC2", "status": status},
        ]

        assert compute(criteria_m2, results, [])["verdict"] == NOT_VALIDATED

    def test_nao_validado_tem_precedencia_sobre_reprovado(self, criteria_m2: list[dict]) -> None:
        """'Não conseguimos checar' e 'checamos e quebrou' são fatos diferentes."""
        results = [
            {"id": "AC1", "status": "failed", "note": "quebrou"},
            {"id": "AC2", "status": "not_exercised"},
        ]

        assert compute(criteria_m2, results, [])["verdict"] == NOT_VALIDATED

    def test_evidencia_como_string_unica_e_aceita(self, criteria_m2: list[dict]) -> None:
        results = [
            {"id": "AC1", "status": "passed", "evidence": "evidence/ok.png"},
            {"id": "AC2", "status": "passed", "evidence": "evidence/ok2.png"},
        ]

        assert compute(criteria_m2, results, [])["verdict"] == ACCEPTED


class TestMalformedInput:
    def test_status_desconhecido_e_erro_e_nao_um_veredito(self, criteria_m2: list[dict]) -> None:
        results = [{"id": "AC1", "status": "mostly-ok"}]

        with pytest.raises(MalformedEvidence, match="status 'mostly-ok'"):
            compute(criteria_m2, results, [])

    def test_resultado_sem_id_e_erro(self, criteria_m2: list[dict]) -> None:
        with pytest.raises(MalformedEvidence, match="no `id`"):
            compute(criteria_m2, [{"status": "passed"}], [])

    def test_severidade_desconhecida_e_erro(
        self, criteria_m2: list[dict], passing_results: list[dict]
    ) -> None:
        with pytest.raises(MalformedEvidence, match="severity 'catastrophic'"):
            compute(criteria_m2, passing_results, [{"severity": "catastrophic", "summary": "x"}])
