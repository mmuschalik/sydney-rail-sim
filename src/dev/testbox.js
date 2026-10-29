import * as THREE from 'three';
export default () => new THREE.Mesh(new THREE.BoxGeometry(20, 4, 3), new THREE.MeshStandardMaterial({ color: 0xc0c0c0, metalness: 0.8, roughness: 0.3 }));
