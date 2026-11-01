import * as THREE from "three";

// The WebXR side of the VR cinema (Figma 52:1122). Loaded only when someone presses "Enter VR",
// so three.js never weighs down the flat pages. The film plays on a curved screen from the same
// <video> the page keeps in sync with the server clock.

type Env = "hall" | "rooftop" | "living" | "space";
type XrNav = Navigator & { xr?: { requestSession: (mode: string, init?: object) => Promise<XRSession> } };

const ROWS = 6;
const SEATS = 14;
const SEAT_GAP = 0.72;
const ROW_GAP = 1.15;
const EYE = 1.15; // seated eye height in metres
const AVATARS = [0x8b7cf6, 0x2bb3a3, 0xd4a23a, 0xe3182d, 0x4a90e2];

function emojiTexture(text: string, size = 128, font = "100px serif") {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, size / 2, size / 2 + 6);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function labelTexture(text: string) {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const g = c.getContext("2d")!;
  g.font = "600 30px sans-serif";
  g.fillStyle = "rgba(255,255,255,0.35)";
  g.textBaseline = "middle";
  g.fillText(text, 8, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export async function startXr(o: {
  video: HTMLVideoElement; mode: "immersive-vr" | "immersive-ar"; env: Env; size: number; seatRow: number; friends: number; code?: string; onEnd: () => void;
}) {
  const xr = (navigator as XrNav).xr;
  if (!xr) throw new Error("This browser has no WebXR. Open the page in your headset's browser.");
  const session = await xr.requestSession(o.mode, { optionalFeatures: ["local-floor"] });

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType("local-floor");
  renderer.domElement.style.display = "none";
  document.body.appendChild(renderer.domElement);
  await renderer.xr.setSession(session);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  scene.add(new THREE.AmbientLight(0xffffff, 0.35));

  // The viewer sits at the origin; the screen curves in front at radius R.
  const R = 14;
  const screenGroup = new THREE.Group();
  const texture = new THREE.VideoTexture(o.video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.x = -1; // seen from inside the cylinder, so flip it back
  const width = 18;
  const height = width * 9 / 16;
  const arc = width / R;
  const screen = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, height, 96, 1, true, Math.PI - arc / 2, arc),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.BackSide, toneMapped: false }),
  );
  screen.position.set(0, EYE + 1.6, 0);
  screenGroup.add(screen);
  // Red glow behind the screen, as in the frame.
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.5, height * 1.6), new THREE.MeshBasicMaterial({ color: 0xe3182d, transparent: true, opacity: 0.12, depthWrite: false }));
  glow.position.set(0, EYE + 1.6, -R - 0.3);
  screenGroup.add(glow);
  // The viewer's code drifts over the picture, as on the flat player.
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: labelTexture(`E-CINEMA · ${o.code ?? ""}`), transparent: true, depthTest: false }));
  mark.scale.set(2.4, 0.3, 1);
  screenGroup.add(mark);
  const moveMark = () => mark.position.set((Math.random() - 0.5) * width * 0.7, EYE + 1.6 + (Math.random() - 0.5) * height * 0.7, -R + 0.4);
  moveMark();
  const markTimer = setInterval(moveMark, 20000);
  scene.add(screenGroup);
  const setSize = (s: number) => screenGroup.scale.setScalar(0.6 + (s / 100) * 0.4);
  setSize(o.size);

  // The hall: seats in rows around the viewer's own, and friends beside them.
  const hall = new THREE.Group();
  const seatGeo = new THREE.BoxGeometry(0.6, 0.9, 0.6);
  const seats = new THREE.InstancedMesh(seatGeo, new THREE.MeshStandardMaterial({ color: 0x1b1b21, roughness: 0.9 }), ROWS * SEATS);
  const m = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let s = 0; s < SEATS; s++) {
      const x = (s - (SEATS - 1) / 2) * SEAT_GAP;
      const z = (r - o.seatRow) * ROW_GAP;
      if (r === o.seatRow && Math.abs(x) < SEAT_GAP / 2) continue; // your own seat is where you are
      m.makeTranslation(x, 0.45 - (o.seatRow - r) * 0.18, z + 0.35);
      seats.setMatrixAt(n++, m);
    }
  }
  seats.count = n;
  hall.add(seats);
  for (let i = 0; i < Math.min(o.friends, 4); i++) {
    const side = i % 2 === 0 ? 1 : -1;
    const x = side * SEAT_GAP * (1 + Math.floor(i / 2));
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 24, 16), new THREE.MeshStandardMaterial({ color: AVATARS[i % AVATARS.length] }));
    head.position.set(x, EYE, 0.05);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.35, 6, 12), new THREE.MeshStandardMaterial({ color: AVATARS[i % AVATARS.length] }));
    body.position.set(x, EYE - 0.45, 0.1);
    hall.add(head, body);
  }
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x0a0a0c, roughness: 1 }));
  floor.rotation.x = -Math.PI / 2;
  hall.add(floor);
  const light = new THREE.PointLight(0xe3182d, 30, 40);
  light.position.set(0, EYE + 2, -R + 2);
  hall.add(light);
  scene.add(hall);

  // Surroundings for each environment.
  const sky = new THREE.Group();
  scene.add(sky);
  const setEnv = (e: Env) => {
    sky.clear();
    hall.visible = e !== "living";
    if (e === "living") return; // passthrough AR: the room itself is the backdrop
    if (e === "hall") {
      sky.add(new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ color: 0x0b0819, side: THREE.BackSide })));
    } else if (e === "rooftop") {
      const g = new THREE.SphereGeometry(120, 32, 16);
      const colors: number[] = [];
      const pos = g.attributes.position;
      const low = new THREE.Color(0xff7a3d), high = new THREE.Color(0x0b1a3a), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        c.copy(low).lerp(high, Math.min(1, Math.max(0, pos.getY(i) / 50 + 0.1)));
        colors.push(c.r, c.g, c.b);
      }
      g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      sky.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
      // A ring of tower blocks on the skyline, lit windows and all.
      const towers = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x111622 }), 90);
      for (let i = 0; i < 90; i++) {
        const a = (i / 90) * Math.PI * 2;
        const h = 6 + ((i * 37) % 23);
        m.compose(new THREE.Vector3(Math.sin(a) * 70, h / 2 - 8, Math.cos(a) * 70), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), a), new THREE.Vector3(5 + (i % 4), h, 5));
        towers.setMatrixAt(i, m);
      }
      sky.add(towers);
    } else {
      sky.add(new THREE.Mesh(new THREE.SphereGeometry(150, 32, 16), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide })));
      const pts: number[] = [];
      for (let i = 0; i < 3000; i++) {
        const v = new THREE.Vector3().randomDirection().multiplyScalar(100 + Math.random() * 40);
        if (v.y > -5) pts.push(v.x, v.y, v.z);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
      sky.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.35 })));
    }
  };
  setEnv(o.env);

  // Reactions rise from just below the screen and fade.
  const floaters: { s: THREE.Sprite; born: number }[] = [];
  const react = (emoji: string) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: emojiTexture(emoji), transparent: true, depthWrite: false }));
    s.scale.setScalar(0.5);
    s.position.set((Math.random() - 0.5) * 4, EYE + 0.2, -3 - Math.random() * 2);
    scene.add(s);
    floaters.push({ s, born: performance.now() });
  };

  renderer.setAnimationLoop((t) => {
    for (let i = floaters.length - 1; i >= 0; i--) {
      const f = floaters[i];
      const age = (t - f.born) / 2600;
      if (age >= 1) {
        scene.remove(f.s);
        f.s.material.map?.dispose();
        f.s.material.dispose();
        floaters.splice(i, 1);
        continue;
      }
      f.s.position.y += 0.012;
      f.s.material.opacity = 1 - age;
    }
    renderer.render(scene, camera);
  });

  session.addEventListener("end", () => {
    renderer.setAnimationLoop(null);
    clearInterval(markTimer);
    texture.dispose();
    renderer.dispose();
    renderer.domElement.remove();
    o.onEnd();
  });

  return { end: () => void session.end(), react, setEnv, setSize };
}
