"""Behaviour tests for the /goal condition composer.

Each test names the behaviour it protects, not the function it calls.
"""
from __future__ import annotations

import pytest

from compose_goal_condition import (
    GOAL_CHAR_CAP,
    GateViolation,
    Milestone,
    compose,
    parse_roadmap,
    select,
)


class TestParseRoadmap:
    def test_le_id_nome_estado_e_dependencias_de_cada_milestone(self, roadmap_text: str) -> None:
        milestones = parse_roadmap(roadmap_text)

        assert set(milestones) == {"M0", "M1", "M2", "M3", "M4"}
        assert milestones["M2"].name == "Streaming"
        assert milestones["M2"].done is False
        assert milestones["M1"].done is True
        assert milestones["M3"].dependencies == ("M2",)

    def test_milestone_sem_dependencia_declarada_fica_sem_dependencia(self) -> None:
        text = "### M7 — [ ] Solo\n\n**Objective:** nothing.\n"

        assert parse_roadmap(text)["M7"].dependencies == ()

    def test_id_duplicado_e_recusado_porque_quebra_o_flip_unico(self) -> None:
        text = "### M2 — [ ] A\n\n### M2 — [ ] B\n"

        with pytest.raises(GateViolation, match="more than once"):
            parse_roadmap(text)

    def test_cabecalho_em_outro_nivel_nao_e_lido_como_milestone(self) -> None:
        """cycle-release só flipa `### M<N>`; ler `## M<N>` aqui esconderia a divergência."""
        text = "## M2 — [ ] Streaming\n\n**Objective:** sse.\n"

        assert parse_roadmap(text) == {}


class TestSelect:
    def test_devolve_os_milestones_pedidos_em_ordem_ascendente(self, roadmap_text: str) -> None:
        ordered = select(parse_roadmap(roadmap_text), ["M3", "M2"])

        assert [m.milestone_id for m in ordered] == ["M2", "M3"]

    def test_recusa_milestone_ausente_do_roadmap(self, roadmap_text: str) -> None:
        with pytest.raises(GateViolation, match="not in the roadmap: M9"):
            select(parse_roadmap(roadmap_text), ["M9"])

    def test_recusa_milestone_ja_lancado(self, roadmap_text: str) -> None:
        """Uma meta sobre trabalho concluído já nasce satisfeita — inútil e enganosa."""
        with pytest.raises(GateViolation, match="already released"):
            select(parse_roadmap(roadmap_text), ["M1"])

    def test_recusa_quando_a_dependencia_nao_foi_lancada_nem_esta_na_chamada(
        self, roadmap_text: str
    ) -> None:
        with pytest.raises(GateViolation, match="dependency wall: M4 depends on M3"):
            select(parse_roadmap(roadmap_text), ["M4"])

    def test_aceita_dependencia_satisfeita_dentro_da_propria_chamada(self, roadmap_text: str) -> None:
        ordered = select(parse_roadmap(roadmap_text), ["M2", "M3", "M4"])

        assert [m.milestone_id for m in ordered] == ["M2", "M3", "M4"]

    def test_aceita_dependencia_ja_lancada(self, roadmap_text: str) -> None:
        assert [m.milestone_id for m in select(parse_roadmap(roadmap_text), ["M2"])] == ["M2"]

    def test_recusa_lista_vazia(self, roadmap_text: str) -> None:
        with pytest.raises(GateViolation, match="no milestone requested"):
            select(parse_roadmap(roadmap_text), [])

    def test_recusa_id_com_formato_invalido(self, roadmap_text: str) -> None:
        with pytest.raises(GateViolation, match="invalid milestone id"):
            select(parse_roadmap(roadmap_text), ["milestone-2"])

    def test_recusa_id_repetido(self, roadmap_text: str) -> None:
        with pytest.raises(GateViolation, match="repeated milestone"):
            select(parse_roadmap(roadmap_text), ["M2", "M2"])


class TestCompose:
    def test_nomeia_a_cadeia_e_cada_milestone_pedido(self, roadmap_text: str) -> None:
        condition = compose(select(parse_roadmap(roadmap_text), ["M2", "M3"]))

        assert "[M2 → M3]" in condition
        assert "M2 — Streaming" in condition
        assert "M3 — Quotas" in condition

    def test_exige_as_sete_fases_do_cycle_e_o_flip_do_roadmap(self, roadmap_text: str) -> None:
        condition = compose(select(parse_roadmap(roadmap_text), ["M2"]))

        for phase in (
            "cycle-discover",
            "cycle-plan",
            "cycle-implement",
            "cycle-code-quality",
            "cycle-review",
            "cycle-release",
            "cycle-acceptance",
        ):
            assert phase in condition
        assert "ROADMAP.md" in condition

    def test_exige_evidencia_por_criterio_na_aceitacao(self, roadmap_text: str) -> None:
        """RELEASED não basta: o checkbox só é honesto se a entrega foi exercida."""
        condition = compose(select(parse_roadmap(roadmap_text), ["M2"]))

        assert "ACCEPTED" in condition
        assert "evidence per criterion" in condition


class TestStopCriterion:
    """A aceitação é O critério de parada — regra inquebrável, não um item da lista."""

    def test_declara_a_aceitacao_como_o_unico_criterio_de_parada(self, roadmap_text: str) -> None:
        condition = compose(select(parse_roadmap(roadmap_text), ["M2"]))

        assert "UNBREAKABLE — THE STOP CRITERION IS THE ACCEPTANCE RUN" in condition
        assert "if and only if /acceptance" in condition

    def test_nomeia_o_que_explicitamente_nao_encerra_a_meta(self, roadmap_text: str) -> None:
        condition = compose(select(parse_roadmap(roadmap_text), ["M2"]))

        for insufficient in ("green test suite", "READY_TO_MERGE", "RELEASED", "published tag"):
            assert insufficient in condition
        assert "RELEASED means it shipped; only the acceptance verdict means it works" in condition

    def test_veredito_negativo_nunca_satisfaz(self, roadmap_text: str) -> None:
        condition = compose(select(parse_roadmap(roadmap_text), ["M2"]))

        assert "REJECTED and NOT_VALIDATED never satisfy this goal" in condition

    def test_fecha_as_tres_saidas_pela_tangente(self, roadmap_text: str) -> None:
        """Re-rodar sem corrigir, mexer no DoD e inventar veredito são violações."""
        condition = compose(select(parse_roadmap(roadmap_text), ["M2"]))

        assert "without fixing what it found" in condition
        assert "editing the milestone's Definition of done" in condition
        assert "compute_acceptance_verdict.py did not print" in condition

    def test_proibe_pular_fase_e_afirmar_resultado_sem_evidencia(self, roadmap_text: str) -> None:
        condition = compose(select(parse_roadmap(roadmap_text), ["M2"]))

        assert "NOT met if any phase was skipped" in condition
        assert "asserted rather than shown" in condition

    def test_exige_pr_de_workspace_para_develop(self, roadmap_text: str) -> None:
        condition = compose(select(parse_roadmap(roadmap_text), ["M2"]))

        assert "workspace → develop" in condition
        assert "never a direct commit to develop or main" in condition

    def test_cabe_no_limite_de_4000_chars_com_o_roadmap_cheio(self) -> None:
        """M0-M8 é o teto do /roadmap-init — a condição precisa caber nesse pior caso."""
        ordered = [
            Milestone(milestone_id=f"M{n}", name=f"Milestone number {n}", done=False, dependencies=())
            for n in range(9)
        ]

        assert len(compose(ordered)) <= GOAL_CHAR_CAP
