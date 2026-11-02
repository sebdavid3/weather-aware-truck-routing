from django.urls import path

from planner import views

urlpatterns = [
    path("health", views.health, name="health"),
    path("places", views.places, name="places"),
    path("routes", views.routes, name="routes"),
    path("heatmap", views.heatmap, name="heatmap"),
]
