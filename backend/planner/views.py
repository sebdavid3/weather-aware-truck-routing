import logging
from functools import cache

from django.conf import settings
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.request import Request
from rest_framework.response import Response

from planner.geocoding import GeocodingError, TomTomGeocoder
from planner.planning import TooManyCheckpoints, plan_heatmap, plan_preview, plan_trip
from planner.routing import NoRouteFound, RoutingRateLimited, RoutingUnavailable, TomTomRouter
from planner.serializers import TripSerializer
from planner.weather import OpenMeteoClient, WeatherRateLimited, WeatherUnavailable

logger = logging.getLogger(__name__)

MIN_QUERY_LENGTH = 3


@cache
def router() -> TomTomRouter:
    return TomTomRouter(settings.TOMTOM_API_KEY)


@cache
def weather() -> OpenMeteoClient:
    return OpenMeteoClient()


@cache
def geocoder() -> TomTomGeocoder:
    return TomTomGeocoder(settings.TOMTOM_API_KEY)


@api_view(["GET"])
def health(request: Request) -> Response:
    return Response({"status": "ok"})


@api_view(["GET"])
def places(request: Request) -> Response:
    query = request.query_params.get("q", "").strip()
    if len(query) < MIN_QUERY_LENGTH:
        return Response({"places": []})
    try:
        found = geocoder().search(query)
    except GeocodingError as exc:
        return _error(status.HTTP_502_BAD_GATEWAY, str(exc))
    return Response({"places": [place.__dict__ for place in found]})


@api_view(["POST"])
def routes(request: Request) -> Response:
    return _plan(request, plan_trip)


@api_view(["POST"])
def route_preview(request: Request) -> Response:
    return _plan(request, plan_preview)


@api_view(["POST"])
def heatmap(request: Request) -> Response:
    return _plan(request, plan_heatmap)


def _plan(request: Request, planner) -> Response:
    """Run a planner; failures reach the user in plain words, the details stay in the log."""
    serializer = TripSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        return Response(planner(serializer.validated_data, router(), weather()))
    except TooManyCheckpoints as exc:
        logger.info("Trip refused: %s", exc)
        return _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "This trip has too many checkpoints at this spacing. "
            "Choose a longer checkpoint interval.",
        )
    except NoRouteFound as exc:
        logger.info("No route: %s", exc)
        return _error(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "No truck route connects these two places. Try a nearby city or street address.",
        )
    except (RoutingRateLimited, WeatherRateLimited) as exc:
        logger.warning("Rate limited: %s", exc)
        response = _error(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            f"Trip planning is busy right now. Try again in {_wait_text(exc.retry_after_s)}.",
        )
        response["Retry-After"] = str(exc.retry_after_s)
        return response
    except RoutingUnavailable as exc:
        logger.warning("Routing unavailable: %s", exc)
        return _error(
            status.HTTP_502_BAD_GATEWAY,
            "Truck routes aren't available right now. Try again in a moment.",
        )
    except WeatherUnavailable as exc:
        logger.warning("Weather unavailable: %s", exc)
        return _error(
            status.HTTP_502_BAD_GATEWAY,
            "The forecast isn't available right now. Try again in a moment.",
        )


def _wait_text(seconds: int) -> str:
    if seconds <= 90:
        return "a minute"
    if seconds < 3600:
        return f"{round(seconds / 60)} minutes"
    if seconds < 86_400:
        return "an hour" if seconds < 5400 else f"{round(seconds / 3600)} hours"
    return "a day"


def _error(code: int, message: str) -> Response:
    return Response({"detail": message}, status=code)
