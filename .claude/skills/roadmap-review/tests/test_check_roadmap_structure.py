"""Behaviour tests for the roadmap structural review.

Organised by the four axes the skill promises: inconsistencies, edge cases,
clarity, cohesion — plus the fixtures oracle and the verdict derivation.
"""
from __future__ import annotations

import pytest

from check_roadmap_structure import (
    INVALID,
    NEEDS_REVISION,
    SHIPPABLE,
    SHIPPABLE_WITH_CAVEATS,
    review,
)


def checks(text: str) -> set[str]:
    return {f.check for f in review(text)[1]}


def verdict(text: str) -> str:
    return review(text)[0]


class TestFixturesOracle:
    """roadmap-init's own reference examples. Approving the bad one would be disqualifying."""

    def test_aprova_o_roadmap_de_referencia(self, good_text: str) -> None:
        assert verdict(good_text) == SHIPPABLE

    def test_reprova_o_anti_exemplo(self, bad_text: str) -> None:
        assert verdict(bad_text) == INVALID

    def test_pega_o_problema_manchete_do_anti_exemplo(self, bad_text: str) -> None:
        """12 milestones acima do teto de 9 — o defeito que a fixture existe para ilustrar."""
        assert "milestone_cap_exceeded" in checks(bad_text)

    def test_nao_confunde_placeholder_citado_com_placeholder_esquecido(self, good_text: str) -> None:
        """A fixture boa escreve `{{name}}` numa crase, explicando como cancelar um milestone."""
        assert "unfilled_placeholder" not in checks(good_text)

    def test_pega_placeholder_de_template_de_verdade(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "Skeleton", dependencies="none"))
        text += "\nGoal: {{V1_SHIP_CRITERION}}\n"

        assert "unfilled_placeholder" in checks(text)


class TestInconsistencies:
    def test_ciclo_de_dependencia(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            make_milestone("M0", "A", dependencies="M2"),
            make_milestone("M1", "B", dependencies="M0"),
            make_milestone("M2", "C", dependencies="M1"),
        )

        assert "dependency_cycle" in checks(text)
        assert verdict(text) == INVALID

    def test_dependencia_de_milestone_inexistente(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dependencies="M7"))

        assert "unknown_dependency" in checks(text)

    def test_auto_dependencia(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dependencies="M0"))

        assert "self_dependency" in checks(text)

    def test_dependencia_para_frente(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            make_milestone("M0", "A", dependencies="M1"),
            make_milestone("M1", "B", dependencies="none"),
        )

        assert "forward_dependency" in checks(text)

    def test_lancado_antes_da_propria_dependencia(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            make_milestone("M0", "A", state=" ", dependencies="none"),
            make_milestone("M1", "B", state="x", dependencies="M0"),
        )

        assert "released_before_dependency" in checks(text)

    def test_id_duplicado(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            make_milestone("M0", "A", dependencies="none"),
            make_milestone("M0", "B", dependencies="none"),
        )

        assert "duplicate_milestone_id" in checks(text)


class TestEdgeCases:
    """Casos-limite que quebram contratos a jusante, não apenas o texto."""

    def test_cabecalho_no_nivel_errado_impede_o_flip(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dependencies="none")).replace("### M0", "## M0")

        assert "wrong_header_level" in checks(text)

    def test_milestone_sem_checkbox(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dependencies="none")).replace(
            "### M0 — [ ] A", "### M0 — A"
        )

        assert "missing_checkbox" in checks(text)

    def test_sem_definition_of_done_bloqueia_a_aceitacao(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dod=(), dependencies="none"))

        assert "missing_definition_of_done" in checks(text)
        assert verdict(text) == INVALID

    def test_teto_de_nove_milestones(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            *[make_milestone(f"M{n}", f"Feature {n}", dependencies="none") for n in range(10)]
        )

        assert "milestone_cap_exceeded" in checks(text)

    def test_nove_milestones_ainda_cabem(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            *[make_milestone(f"M{n}", f"Feature {n}", dependencies="none") for n in range(9)]
        )

        assert "milestone_cap_exceeded" not in checks(text)

    def test_avisa_que_o_relatorio_e_um_piso_quando_ha_header_malformado(
        self, make_roadmap, make_milestone
    ) -> None:
        """Header quebrado esconde as checagens por milestone — dizer isso evita falso conforto."""
        text = make_roadmap(
            make_milestone("M0", "A", dependencies="none"),
            make_milestone("M1", "B", dependencies="M0"),
        ).replace("### M1 — [ ] B", "## M1 — [ ] B")

        assert "checks_skipped_behind_malformed_header" in checks(text)

    def test_roadmap_sem_nenhum_milestone(self, make_roadmap) -> None:
        assert "no_milestones" in checks(make_roadmap())


class TestClarity:
    def test_bullet_vago_sem_numero(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dod=("Improve performance.",), dependencies="none"))

        assert "vague_dod_bullet" in checks(text)

    @pytest.mark.parametrize(
        "bullet",
        ["P95 latency improved to under 50ms.", "Zero credentials leak outside the gateway."],
    )
    def test_bullet_com_numero_ou_limite_nao_e_vago(
        self, make_roadmap, make_milestone, bullet: str
    ) -> None:
        text = make_roadmap(
            make_milestone("M0", "A", dod=(bullet, "Second observable condition."), dependencies="none")
        )

        assert "vague_dod_bullet" not in checks(text)

    def test_definition_of_done_vazio(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dependencies="none")).replace(
            "- [ ] P95 latency stays under 50ms.\n- [ ] Failover covered by an integration test.\n", ""
        )

        assert "empty_definition_of_done" in checks(text)

    def test_secao_de_topo_ausente(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dependencies="none"), sections=False)

        assert "missing_section" in checks(text)

    def test_out_of_scope_vazio(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dependencies="none")).replace(
            "- Something deliberately excluded.\n", ""
        )

        assert "empty_out_of_scope" in checks(text)


class TestCohesion:
    def test_milestone_que_e_camada_e_nao_entrega(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "Backend", dependencies="none"))

        assert "milestone_is_not_a_delivery" in checks(text)

    def test_milestone_que_e_trabalho_continuo(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "Refactor", dependencies="none"))

        assert "milestone_is_not_a_delivery" in checks(text)

    def test_nome_legitimo_que_contem_a_palavra_nao_e_marcado(
        self, make_roadmap, make_milestone
    ) -> None:
        """'Backend rate limiting' é uma entrega; 'Backend' sozinho não é."""
        text = make_roadmap(
            make_milestone("M0", "Backend rate limiting for the quota API", dependencies="none")
        )

        assert "milestone_is_not_a_delivery" not in checks(text)

    def test_definition_of_done_com_um_unico_bullet(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            make_milestone("M0", "A", dod=("Ships to staging with 2 replicas.",), dependencies="none")
        )

        assert "thin_definition_of_done" in checks(text)

    def test_dependencias_ausentes_pede_none_explicito(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(make_milestone("M0", "A", dependencies=None))

        assert "missing_dependencies" in checks(text)


class TestVerdict:
    def test_roadmap_saudavel_e_shippable(self, healthy: str) -> None:
        assert verdict(healthy) == SHIPPABLE

    def test_apenas_minor_da_shippable_with_caveats(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            make_milestone("M0", "Walking skeleton", dependencies="none"),
            make_milestone("M1", "Streaming", dod=("Streams within 200ms.",), dependencies="M0"),
        )

        assert verdict(text) == SHIPPABLE_WITH_CAVEATS

    def test_major_derruba_para_needs_revision(self, make_roadmap, make_milestone) -> None:
        text = make_roadmap(
            make_milestone("M0", "Walking skeleton", dependencies="none"),
            make_milestone(
                "M1", "Streaming", dod=("Make it faster.", "And more robust."), dependencies="M0"
            ),
        )

        assert verdict(text) == NEEDS_REVISION

    def test_blocker_derruba_para_invalid(self, healthy: str) -> None:
        assert verdict(healthy.replace("### M1", "## M1")) == INVALID

    def test_toda_finding_declara_se_e_deterministica_ou_heuristica(self, bad_text: str) -> None:
        _v, findings = review(bad_text)

        assert findings
        assert all(f.source in {"deterministic", "heuristic"} for f in findings)
