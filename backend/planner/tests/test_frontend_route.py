def test_planner_route_serves_the_built_app(client, settings, tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><div id=root></div>")
    settings.FRONTEND_DIST = tmp_path

    response = client.get("/plan")

    assert response.status_code == 200
    assert b"id=root" in b"".join(response.streaming_content)


def test_planner_route_is_404_without_a_build(client, settings, tmp_path):
    settings.FRONTEND_DIST = tmp_path / "missing"

    assert client.get("/plan").status_code == 404
