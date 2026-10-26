# OSRM (Gwalior)

Road network: Geofabrik `central-zone` extract clipped to bbox `78.05,26.12,78.32,26.32`, car profile, MLD.

```
bash osrm/build.sh        # download, clip, extract, partition, customize (first run is slow)
docker compose up osrm    # serves http://localhost:5000
```

Check: `curl "http://localhost:5000/route/v1/driving/78.17,26.21;78.19,26.22?overview=false"`

`osrm/data/` is git-ignored.
