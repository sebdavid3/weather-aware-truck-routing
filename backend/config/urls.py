from django.conf import settings
from django.http import FileResponse, Http404, HttpRequest
from django.urls import include, path


def frontend(request: HttpRequest) -> FileResponse:
    """The built single-page app for client-side routes; WhiteNoise serves "/" itself."""
    index = settings.FRONTEND_DIST / "index.html"
    if not index.is_file():
        raise Http404("The frontend is not built")
    return FileResponse(index.open("rb"), content_type="text/html")


urlpatterns = [
    path("api/", include("planner.urls")),
    path("plan", frontend),
]
