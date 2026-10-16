"""Built-in API price table (USD per million tokens). Editable per model in the app."""
import re

# name prefix -> (provider, input, output, cache_write, cache_read)
DEFAULT_PRICES: dict[str, tuple[str, float, float, float, float]] = {
    "claude-opus-4-5": ("anthropic", 5.0, 25.0, 6.25, 0.50),
    "claude-opus-4-1": ("anthropic", 15.0, 75.0, 18.75, 1.50),
    "claude-opus-4": ("anthropic", 15.0, 75.0, 18.75, 1.50),
    "claude-sonnet-4-5": ("anthropic", 3.0, 15.0, 3.75, 0.30),
    "claude-sonnet-4": ("anthropic", 3.0, 15.0, 3.75, 0.30),
    "claude-haiku-4-5": ("anthropic", 1.0, 5.0, 1.25, 0.10),
    "claude-3-5-haiku": ("anthropic", 0.8, 4.0, 1.0, 0.08),
    "gpt-5.1-codex-mini": ("openai", 0.25, 2.0, 0.0, 0.025),
    "gpt-5.1-codex": ("openai", 1.25, 10.0, 0.0, 0.125),
    "gpt-5-codex": ("openai", 1.25, 10.0, 0.0, 0.125),
    "gpt-5-mini": ("openai", 0.25, 2.0, 0.0, 0.025),
    "gpt-5": ("openai", 1.25, 10.0, 0.0, 0.125),
}

_DATE_SUFFIX = re.compile(r"-(\d{8}|\d{4}-\d{2}-\d{2})$")


def normalize_model_name(raw: str) -> str:
    name = raw.strip().lower()
    if "/" in name:
        name = name.split("/")[-1]
    return _DATE_SUFFIX.sub("", name)


def lookup_default_price(name: str):
    for prefix in sorted(DEFAULT_PRICES, key=len, reverse=True):
        if name == prefix or name.startswith(prefix + "-") or name.startswith(prefix + "."):
            return DEFAULT_PRICES[prefix]
    return None


def compute_cost(model, input_t: int, output_t: int, cache_w: int, cache_r: int) -> float | None:
    """Return API-equivalent cost or None when the model has no known price."""
    if model is None or model.input_price is None or model.output_price is None:
        return None
    cw = model.cache_write_price if model.cache_write_price is not None else model.input_price
    cr = model.cache_read_price if model.cache_read_price is not None else model.input_price
    return round((input_t * model.input_price + output_t * model.output_price + cache_w * cw + cache_r * cr) / 1_000_000, 6)
