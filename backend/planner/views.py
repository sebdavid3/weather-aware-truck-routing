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
    serializer = TripSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    try:
        return Response(planner(serializer.validated_data, router(), weather()))
    except (TooManyCheckpoints, NoRouteFound) as exc:
        return _error(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc))
    except (RoutingRateLimited, WeatherRateLimited) as exc:
        response = _error(status.HTTP_503_SERVICE_UNAVAILABLE, str(exc))
        response["Retry-After"] = str(exc.retry_after_s)
        return response
    except (RoutingUnavailable, WeatherUnavailable) as exc:
        return _error(status.HTTP_502_BAD_GATEWAY, str(exc))


def _error(code: int, message: str) -> Response:
    return Response({"detail": message}, status=code)
