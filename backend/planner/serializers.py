from datetime import UTC, datetime, timedelta

from rest_framework import serializers

from planner.geometry import haversine_m
from planner.planning import TripRequest
from planner.trip import departure_utc

PAST_TOLERANCE = timedelta(minutes=15)
FUTURE_WINDOW = timedelta(days=7)
MAX_LOAD_LB = 80_000  # The federal gross weight limit; no single load can exceed it.
MIN_TRIP_M = 1_000


class PointSerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lon = serializers.FloatField(min_value=-180, max_value=180)


class TripSerializer(serializers.Serializer):
    """A trip as the form sends it; `departure` is wall-clock time at the origin."""

    origin = PointSerializer()
    destination = PointSerializer()
    departure = serializers.DateTimeField(
        input_formats=["%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S"], default_timezone=None
    )
    load_lb = serializers.IntegerField(min_value=0, max_value=MAX_LOAD_LB)
    interval_miles = serializers.ChoiceField(choices=[10, 25, 50])
    rest_breaks = serializers.BooleanField(default=False)

    def validate(self, attrs):
        origin = (attrs["origin"]["lat"], attrs["origin"]["lon"])
        destination = (attrs["destination"]["lat"], attrs["destination"]["lon"])
        if haversine_m(origin, destination) < MIN_TRIP_M:
            raise serializers.ValidationError(
                {"destination": "The destination must differ from the origin."}
            )

        departure = departure_utc(attrs["departure"].replace(tzinfo=None), origin)
        now = datetime.now(UTC)
        if departure < now - PAST_TOLERANCE:
            raise serializers.ValidationError({"departure": "The departure is in the past."})
        if departure > now + FUTURE_WINDOW:
            raise serializers.ValidationError(
                {"departure": "Choose a departure within the next 7 days."}
            )

        return TripRequest(
            origin=origin,
            destination=destination,
            departure=departure,
            load_lb=attrs["load_lb"],
            interval_miles=int(attrs["interval_miles"]),
            rest_breaks=attrs["rest_breaks"],
        )
