export type Vector = {
  x: number;
  y: number;
  z: number;
};

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

const goldenAngle = Math.PI * (3 - Math.sqrt(5));

// Unit vectors spread evenly over a cone around `axis`. The half angle is in degrees, and 180
// covers every direction.
export function directions(count: number, axis: Vector, halfAngle: number): Array<Vector> {
  const length = Math.hypot(axis.x, axis.y, axis.z);
  const w = { x: axis.x / length, y: axis.y / length, z: axis.z / length };
  // Two more unit vectors that stand at right angles to the axis and to each other.
  const helper = Math.abs(w.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const cross = {
    x: helper.y * w.z - helper.z * w.y,
    y: helper.z * w.x - helper.x * w.z,
    z: helper.x * w.y - helper.y * w.x,
  };
  const crossLength = Math.hypot(cross.x, cross.y, cross.z);
  const u = { x: cross.x / crossLength, y: cross.y / crossLength, z: cross.z / crossLength };
  const v = {
    x: w.y * u.z - w.z * u.y,
    y: w.z * u.x - w.x * u.z,
    z: w.x * u.y - w.y * u.x,
  };

  // Equal steps along the axis cut a sphere into bands of equal area. The golden angle spreads
  // the points around it.
  const edge = Math.cos(radians(halfAngle));
  const rays: Array<Vector> = [];
  for (let index = 0; index < count; index += 1) {
    const along = 1 - ((1 - edge) * (index + 0.5)) / count;
    const across = Math.sqrt(1 - along * along);
    const turn = goldenAngle * index;
    const a = Math.cos(turn) * across;
    const b = Math.sin(turn) * across;
    rays.push({
      x: u.x * a + v.x * b + w.x * along,
      y: u.y * a + v.y * b + w.y * along,
      z: u.z * a + v.z * b + w.z * along,
    });
  }
  return rays;
}

// How many times closer together the rays of a cone lie than those of a look all around.
export function zoom(halfAngle: number): number {
  return Math.sqrt(2 / (1 - Math.cos(radians(halfAngle))));
}
