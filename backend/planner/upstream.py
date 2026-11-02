"""HTTP helpers shared by the clients of external APIs."""

import logging
import time
from collections.abc import Mapping, Sequence

import httpx

logger = logging.getLogger(__name__)


class UpstreamFailed(Exception):
    """An external API timed out or failed with a server error, twice."""


def get_with_retry(
    http: httpx.Client,
    url: str,
    params: Mapping[str, str | Sequence[str]],
    *,
    service: str,
    retry_delay_s: float,
) -> httpx.Response:
    """GET, retrying once after a timeout, a connection error or a 5xx.

    Any other response, including a 429, goes back to the caller unretried:
    retrying a usage limit would only spend more of it.
    """
    problem = ""
    for attempt in range(2):
        try:
            response = http.get(url, params=params)
        except httpx.TransportError as exc:
            problem = type(exc).__name__
        else:
            if response.status_code < 500:
                return response
            problem = f"HTTP {response.status_code}"
        # The URL can carry an API key, so only the problem is logged.
        logger.warning("%s request failed (attempt %d): %s", service, attempt + 1, problem)
        if attempt == 0:
            time.sleep(retry_delay_s)
    raise UpstreamFailed(f"{service} failed twice: {problem}")
