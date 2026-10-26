import httpx

from app.matrix import build_matrix

PTS = [(26.2, 78.17), (26.21, 78.18), (26.22, 78.19)]


def test_fallback_is_labelled_when_osrm_down():
    def boom(request):
        raise httpx.ConnectError("refused")

    client = httpx.Client(transport=httpx.MockTransport(boom))
    m = build_matrix(PTS, client=client)
    assert m.distance_source == "haversine_fallback"
    assert m.distances_m[0][0] == 0
    assert m.distances_m[0][1] > 0


def test_osrm_values_used_when_available():
    def ok(request):
        return httpx.Response(200, json={"code": "Ok", "distances": [[0, 5.4], [5.6, 0]], "durations": [[0, 9.2], [9.1, 0]]})

    client = httpx.Client(transport=httpx.MockTransport(ok))
    m = build_matrix(PTS[:2], client=client)
    assert m.distance_source == "osrm"
    assert m.distances_m == [[0, 5], [6, 0]]
