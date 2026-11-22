import { describe, expect, test } from "bun:test";

import { coneOver, directions, zoom } from "./rays.ts";

const up = { x: 0, y: 1, z: 0 };
const east = { x: 1, y: 0, z: 0 };

describe("coneOver", () => {
  const eye = { x: 0, y: 0, z: 0 };

  test("goes all around when the eye is in the ball", () => {
    expect(coneOver(eye, { x: 2, y: 1, z: 0 }, 8)).toMatchObject({ halfAngle: 180 });
  });

  test("points at a ball some way off and is just wide enough for it", () => {
    const cone = coneOver(eye, { x: 20, y: 0, z: 0 }, 10);

    expect(cone.axis).toEqual({ x: 20, y: 0, z: 0 });
    expect(cone.halfAngle).toBeCloseTo(30);
    expect(cone.away).toBe(20);
  });
});

describe("directions", () => {
  test("gives as many rays as asked for, each of length one", () => {
    const rays = directions(500, up, 180);

    expect(rays).toHaveLength(500);
    for (const { x, y, z } of rays) {
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 9);
    }
  });

  test("covers every direction evenly at a half angle of 180", () => {
    const rays = directions(2000, up, 180);
    const sum = { x: 0, y: 0, z: 0 };
    for (const ray of rays) {
      sum.x += ray.x;
      sum.y += ray.y;
      sum.z += ray.z;
    }

    expect(Math.abs(sum.x / rays.length)).toBeLessThan(0.01);
    expect(Math.abs(sum.y / rays.length)).toBeLessThan(0.01);
    expect(Math.abs(sum.z / rays.length)).toBeLessThan(0.01);
    expect(rays.filter((ray) => ray.y > 0)).toHaveLength(1000);
  });

  test("keeps every ray inside the cone", () => {
    const rays = directions(1000, east, 25);
    const edge = Math.cos((25 * Math.PI) / 180);

    for (const ray of rays) {
      expect(ray.x).toBeGreaterThanOrEqual(edge - 1e-9);
    }
  });

  test("fills the cone out to its edge", () => {
    const rays = directions(1000, east, 25);
    const widest = Math.min(...rays.map((ray) => ray.x));

    expect(widest).toBeLessThan(Math.cos((24 * Math.PI) / 180));
  });

  test("works along the axis that the frame is built from", () => {
    const rays = directions(100, { x: 0, y: -3, z: 0 }, 30);

    for (const ray of rays) {
      expect(ray.y).toBeLessThan(-0.86);
    }
  });
});

describe("zoom", () => {
  test("is one for a look all around", () => {
    expect(zoom(180)).toBeCloseTo(1, 9);
  });

  test("grows as the cone narrows", () => {
    expect(zoom(90)).toBeCloseTo(Math.SQRT2, 9);
    expect(zoom(25)).toBeCloseTo(4.62, 2);
  });
});
