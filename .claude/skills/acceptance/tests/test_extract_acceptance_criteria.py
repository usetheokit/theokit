"""Behaviour tests for acceptance-criteria extraction."""
from __future__ import annotations

import pytest

from extract_acceptance_criteria import GateViolation, extract


class TestExtract:
    def test_usa_os_bullets_do_definition_of_done_do_milestone(self, roadmap_text: str) -> None:
        payload = extract(roadmap_text, "M2")

        assert payload["milestone_id"] == "M2"
        assert payload["milestone_name"] == "Streaming"
        assert [c["text"] for c in payload["criteria"]] == [
            "Response streams token by token.",
            "Cancelling stops the stream within 1s.",
            "A dropped connection resumes without data loss.",
        ]

    def test_numera_os_criterios_e_declara_a_origem(self, roadmap_text: str) -> None:
        criteria = extract(roadmap_text, "M2")["criteria"]

        assert [c["id"] for c in criteria] == ["AC1", "AC2", "AC3"]
        assert {c["source"] for c in criteria} == {"roadmap-dod"}

    def test_para_no_proximo_rotulo_em_negrito(self, roadmap_text: str) -> None:
        """`**Dependencies:**` e `**Top risks:**` não podem virar critérios de aceite."""
        texts = [c["text"] for c in extract(roadmap_text, "M2")["criteria"]]

        assert not any("Proxy buffering" in t for t in texts)
        assert not any("M1" == t for t in texts)

    def test_le_dod_de_milestone_ja_lancado(self, roadmap_text: str) -> None:
        """Bullets `[x]` continuam sendo critérios — o estado do bullet não é o veredito."""
        assert len(extract(roadmap_text, "M1")["criteria"]) == 2

    def test_recusa_milestone_sem_definition_of_done(self, roadmap_text: str) -> None:
        with pytest.raises(GateViolation, match="no `\\*\\*Definition of done"):
            extract(roadmap_text, "M3")

    def test_recusa_definition_of_done_sem_bullets(self) -> None:
        text = (
            "### M4 — [ ] Empty\n\n"
            "**Definition of done (all must hold):**\n\n"
            "**Dependencies:** none.\n"
        )

        with pytest.raises(GateViolation, match="no `- \\[ \\]` bullets"):
            extract(text, "M4")

    def test_recusa_milestone_ausente(self, roadmap_text: str) -> None:
        with pytest.raises(GateViolation, match="M9 is not in the roadmap"):
            extract(roadmap_text, "M9")

    def test_recusa_id_malformado(self, roadmap_text: str) -> None:
        with pytest.raises(GateViolation, match="invalid milestone id"):
            extract(roadmap_text, "milestone-2")
