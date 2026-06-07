"""Negative fixture — every defined symbol is used. Vulture MUST NOT flag anything."""


def helper(x: int) -> int:
    return x * 2


def driver() -> int:
    return helper(21)


if __name__ == "__main__":
    print(driver())
