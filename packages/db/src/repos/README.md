# Typed repositories

Per ADR-002, raw Drizzle queries should never escape past the infrastructure layer. This directory holds the thin repository classes that handlers consume.

Convention: one repo per feature area. Methods return plain DTOs (no Drizzle result types crossing the boundary).

Populated as slice task phases land — first modules arrive with slice 1 T-004.
