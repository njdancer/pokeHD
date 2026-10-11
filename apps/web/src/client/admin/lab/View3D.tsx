// A turnable 3D view of a sample's relief, built in the browser from its layers with the relief
// editor's own mesh code, so it's exactly what the editor would build. Camera presets match the
// handoff's views: the game camera and isometric for maps; front, angled, side and above for pictures.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { Mesh } from "../../tools/relief/shape.ts";

const VIEWS = {
  map: { "Game camera": [0, 0.75, 0.66], Isometric: [0.7, 0.7, 0.7], "From the side": [1, 0.25, 0.15] },
  pic: { Front: [0, 0, 1], Angled: [0.6, 0.15, 0.8], Side: [1, 0.05, 0.02], Above: [0, 1, 0.08] },
} as const;

export function View3D({ mesh, view, height = 320 }: { mesh: Mesh; view: "map" | "pic"; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const three = useRef<{ renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; controls: OrbitControls; mesh?: THREE.Mesh } | null>(null);
  const names = Object.keys(VIEWS[view]);
  const [camera, setCamera] = useState(names[0]!);
  const [light, setLight] = useState(true);
  const lightRef = useRef(light);
  useEffect(() => { lightRef.current = light; }, [light]);

  useEffect(() => {
    const c = canvas.current!;
    const renderer = new THREE.WebGLRenderer({ canvas: c, antialias: true });
    renderer.setPixelRatio(Math.min(2, devicePixelRatio));
    const scene = new THREE.Scene(); scene.background = new THREE.Color(0x10151c);
    const cam = new THREE.PerspectiveCamera(30, 1, 0.5, 4000);
    const controls = new OrbitControls(cam, c); controls.enableDamping = true;
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1); scene.add(sun);
    three.current = { renderer, scene, camera: cam, controls };
    const resize = () => { const w = c.clientWidth, h = c.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix(); };
    const ro = new ResizeObserver(resize); ro.observe(c); resize();
    let raf = 0, t = 0, last = performance.now();
    const loop = (now: number) => {
      if (lightRef.current) t += (now - last) / 1000;
      last = now;
      sun.position.set(Math.cos(t * 0.6) * 300, 220 + Math.sin(t * 0.6) * 80, 260);
      controls.update(); renderer.render(scene, cam); raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); three.current = null; };
  }, []);

  useEffect(() => {
    const t = three.current; if (!t) return;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(mesh.normals, 3));
    geo.setAttribute("color", new THREE.Float32BufferAttribute(mesh.colours, 3));
    geo.computeBoundingSphere();
    if (t.mesh) { t.scene.remove(t.mesh); t.mesh.geometry.dispose(); (t.mesh.material as THREE.Material).dispose(); }
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
    if (view === "map") { const box = new THREE.Box3().setFromBufferAttribute(geo.getAttribute("position") as THREE.BufferAttribute); m.position.set(-(box.min.x + box.max.x) / 2, 0, -(box.min.z + box.max.z) / 2); }
    t.scene.add(m); t.mesh = m;
  }, [mesh, view]);

  useEffect(() => {
    const t = three.current; if (!t?.mesh) return;
    const sphere = t.mesh.geometry.boundingSphere!, centre = sphere.center.clone().add(t.mesh.position);
    const d = (VIEWS[view] as Record<string, readonly number[]>)[camera] ?? [0, 0, 1];
    const dir = new THREE.Vector3(d[0], d[1], d[2]).normalize();
    const dist = (sphere.radius / Math.sin((t.camera.fov * Math.PI) / 360)) * 0.9;
    t.camera.position.copy(centre).addScaledVector(dir, dist); t.controls.target.copy(centre);
    t.camera.near = dist / 50; t.camera.far = dist * 10; t.camera.updateProjectionMatrix(); t.controls.update();
  }, [camera, mesh, view]);

  return (
    <div className="lab-3d">
      <canvas ref={canvas} style={{ height }} aria-label="3D view: drag to turn, pinch or scroll to zoom" />
      <div className="lab-seg" role="group" aria-label="Camera">
        {names.map((n) => <button type="button" key={n} aria-pressed={camera === n} onClick={() => setCamera(n)}>{n}</button>)}
        <label><input type="checkbox" checked={light} onChange={(e) => setLight(e.target.checked)} /> Moving light</label>
      </div>
    </div>
  );
}
