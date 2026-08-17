"""Positive fixture — contains dead code (unused functions) that vulture must flag."""


def used_helper(x: int) -> int:
    return x * 2


def orphan_function_that_is_never_called(payload: dict) -> dict:
    """This function is declared but no caller exists. Vulture MUST flag it."""
    payload["orphan"] = True
    return payload


class _UnusedClass:
    """This class is declared but never instantiated."""

    def __init__(self) -> None:
        self.value = 42


if __name__ == "__main__":
    print(used_helper(21))
