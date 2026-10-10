import * as THREE from 'three';
import { OrbitControls } from './build/controls/OrbitControls.js';
import { GUI } from './build/gui/lil-gui.module.min.js';
import { MTLLoader } from './build/loaders/MTLLoader.js';
import { OBJLoader } from './build/loaders/OBJLoader.js';       

var rainSound = document.getElementById("rain-sound");
var bgm = document.getElementById("bgm");
const sound = { volume: 0.5, active: false };
var scene = new THREE.Scene();
var ratio = window.innerWidth / window.innerHeight;
var camera = new THREE.PerspectiveCamera(75, ratio, 0.1, 1800);

camera.position.set(0, 90, 30);
camera.lookAt(0, 0, 1);

var renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;

document.body.appendChild(renderer.domElement);

var controls = new OrbitControls(camera, renderer.domElement);
scene.add(camera);
controls.maxPolarAngle = Math.PI/2;
controls.enableDamping = true;

const ambientLight = new THREE.AmbientLight(0x404040, 0); 
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff);
dirLight.position.set(0, 100, 100);
dirLight.castShadow = true;

dirLight.shadow.camera.near = 0.1; 
dirLight.shadow.camera.far = 500; 

dirLight.shadow.camera.left = -100; 
dirLight.shadow.camera.right = 100; 
dirLight.shadow.camera.top = 100; 
dirLight.shadow.camera.bottom = -100; 

dirLight.shadow.mapSize.width = 2048; 
dirLight.shadow.mapSize.height = 2048; 

scene.add(dirLight);
//==================================Ground Texture=============================
const textureLoader = new THREE.TextureLoader();
const groundTexture = textureLoader.load('./textures/ground/vcjmaixs_2K_Albedo.jpg');
const groundAoTexture = textureLoader.load('./textures/ground/vcjmaixs_2K_AO.jpg');
const groundNormalTexture = textureLoader.load('./textures/ground/vcjmaixs_2K_Normal.jpg');
const groundRoughnessTexture = textureLoader.load('./textures/ground/vcjmaixs_2K_Roughness.jpg');
const groundDispTexture = textureLoader.load('./textures/ground/vcjmaixs_2K_Displacement.jpg');

//==================================Grid======================================
var size = 180;
var divisions = 30;
var gridSize = size / divisions;

// Grid class
class Grid {
  constructor(center) {
      this.center = center;
      this.model = null;
  }
}

// Create grid instances
var grids = [];
for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < divisions; j++) {
        var centerX = -size / 2 + gridSize * i + gridSize / 2;
        var centerY = -size / 2 + gridSize * j + gridSize / 2;
        grids.push(new Grid(new THREE.Vector3(centerX, 0, centerY)));
    }
}

//===================================Ground====================================
var groundGeometry = new THREE.PlaneGeometry(size, size, 180, 180);
groundGeometry.setAttribute('uv2', new THREE.Float32BufferAttribute(groundGeometry.attributes.uv.array, 2));
var groundMaterial = new THREE.MeshStandardMaterial({
  side: THREE.DoubleSide,
  map: groundTexture,
  aoMap: groundAoTexture,
  roughnessMap: groundRoughnessTexture,
  displacementMap: groundDispTexture,
  displacementScale: 0.1,
  roughness: 0.5,
  normalMap: groundNormalTexture,
}); 

var ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.receiveShadow = true;
ground.position.set(0, 0, 0);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

//=================================Thumbnail==================================
var modelMap = new Map();
function createThumbnail(model, elementId) {
  // Create a new scene and camera for the thumbnail
  const thumbnailScene = new THREE.Scene();
  const thumbnailCamera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
  thumbnailCamera.position.set(0, 1, 5);
  thumbnailCamera.lookAt(thumbnailScene.position);

  const thumbnailRenderer = new THREE.WebGLRenderer({antialias: true, alpha: true});
  thumbnailRenderer.setClearColor(0x000000, 0);
  thumbnailRenderer.setSize(100, 100);

  const ambientLight = new THREE.AmbientLight(0xffffff, 4);
  thumbnailScene.add(ambientLight);

  const modelClone = model.clone();

  // Calculate the bounding box and center point
  var box3 = new THREE.Box3().setFromObject(modelClone);
  var centerBB = new THREE.Vector3();
  var sizeBB = new THREE.Vector3();
  box3.getCenter(centerBB);
  box3.getSize(sizeBB);

  // Scale the model to a reasonable size range
  var scaleFactor = 1 / sizeBB.length();
  modelClone.scale.set(scaleFactor, scaleFactor, scaleFactor);

  // Recalculate the bounding box and center point
  box3.setFromObject(modelClone);
  box3.getCenter(centerBB);
  box3.getSize(sizeBB);

  // Calculate the scaling factor
  var scale = thumbnailCamera.position.z / sizeBB.length();
  var sca = new THREE.Matrix4();
  var tra = new THREE.Matrix4();
  var combined = new THREE.Matrix4();
  sca.makeScale(scale, scale, scale);
  tra.makeTranslation(-centerBB.x, -centerBB.y, -centerBB.z);
  combined.multiply(sca);
  combined.multiply(tra);

  modelClone.applyMatrix4(combined);
  thumbnailScene.add(modelClone);
  thumbnailRenderer.render(thumbnailScene, thumbnailCamera);

  var thumbnailElement = document.getElementById(elementId);
  thumbnailElement.appendChild(thumbnailRenderer.domElement);
  modelMap.set(thumbnailElement, model);
}

//=================================ObjLoading=================================
const mtlLoader = new MTLLoader();
mtlLoader.load('./objs/buildings/house-green.mtl', (materials) => {
    materials.preload();
    const objLoader = new OBJLoader();
    objLoader.setMaterials(materials);
    objLoader.load('./objs/buildings/house-green.obj', (object) => {
      object.traverse(function(child) {
        if (child instanceof THREE.Mesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      createThumbnail(object, 'item1');
    });
});
mtlLoader.load('./objs/buildings/house_blue2.mtl', (materials) => {
   materials.preload();
   const objLoader = new OBJLoader();
   objLoader.setMaterials(materials);
   objLoader.load('./objs/buildings/house_blue2.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    createThumbnail(object, 'item2');
   });
});
mtlLoader.load('./objs/buildings/house-blue.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('./objs/buildings/house-blue.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
   createThumbnail(object, 'item3');
  });
});

mtlLoader.load('./objs/buildings/house_yellow.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('./objs/buildings/house_yellow.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
   createThumbnail(object, 'item4');
  });  
});

mtlLoader.load('./objs/buildings/house2_yellow.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('./objs/buildings/house2_yellow.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
   createThumbnail(object, 'item5');
  });  
});

mtlLoader.load('./objs/buildings/tree.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('./objs/buildings/tree.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
   createThumbnail(object, 'item6');
  });  
});

mtlLoader.load('./objs/buildings/house2_green.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('./objs/buildings/house2_green.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
   createThumbnail(object, 'item7');
  });  
});

mtlLoader.load('./objs/buildings/road.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('./objs/buildings/road.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
   createThumbnail(object, 'item8');
  });  
});

mtlLoader.load('./objs/buildings/house2_red.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('./objs/buildings/house2_red.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
   createThumbnail(object, 'item9');
  });  
});

mtlLoader.load('./objs/buildings/house2_blue.mtl', (materials) => {
  materials.preload();
  const objLoader = new OBJLoader();
  objLoader.setMaterials(materials);
  objLoader.load('./objs/buildings/house2_blue.obj', (object) => {
    object.traverse(function(child) {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
   createThumbnail(object, 'item10');
  });  
});

//================================Add Buildings===============================
var selectedModel = null;
var dragging = false;
document.getElementById('item-bar').addEventListener('click', function(e) {
  if (selectedModel)
    return;
  var target = e.target;
  while (target !== this && !target.classList.contains('item')) {
    target = target.parentNode;
  }
  if (target.classList.contains('item') && modelMap.has(target)) {
      selectedModel = modelMap.get(target).clone();
      var box3 = new THREE.Box3().setFromObject(selectedModel);
      var sizeBB = new THREE.Vector3();
      box3.getSize(sizeBB);
      var scaleFactor = gridSize / sizeBB.length();
      selectedModel.scale.set(scaleFactor, scaleFactor, scaleFactor);
      scene.add(selectedModel);
      dragging = true;
      target.classList.add('selected');
  }
});

var raycaster = new THREE.Raycaster();
var mouse = new THREE.Vector2();


window.addEventListener("mousemove", function(event) {
  if (selectedModel !== null && dragging) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var intersects = raycaster.intersectObjects(scene.children);
    if (intersects.length > 0) {
      var intersect = intersects[0];
      var gridX = Math.floor(intersect.point.x / gridSize);
      var gridZ = Math.floor(intersect.point.z / gridSize);
      selectedModel.position.set(gridX * gridSize, 1, gridZ * gridSize);
    }
  }
});

window.addEventListener("mouseup", function(event) {
  if (selectedModel !== null && dragging) {
    if (event.button === 2) { 
      scene.remove(selectedModel);
      selectedModel = null;
      dragging = false;
    } 
    else if (event.button === 0) { 
      dragging = false;
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      var intersects = raycaster.intersectObject(ground, false);
      if (intersects.length > 0) {
        var intersect = intersects[0];
        placeModelAtGrid(selectedModel, intersect.point);
      }
      selectedModel = null;
    }
    var selectedItems = document.getElementById('item-bar').getElementsByClassName('selected');
    for (let i = 0; i < selectedItems.length; i++) {
      selectedItems[i].classList.remove('selected');
    }
  }
});

function placeModelAtGrid(model, position) {
  let closestGrid = null;
  let closestDistance = Infinity;
  
  for (let i = 0; i < grids.length; i++) {
    for (let j = 0; j < grids[i].length; j++) {
      let grid = grids[i][j];
      let distance = position.distanceTo(grid.position);
      if (distance < closestDistance) {
        closestGrid = grid;
        closestDistance = distance;
      }
    }
  }
  
  if (closestGrid !== null) {
    if (closestGrid.object !== null) {
      scene.remove(closestGrid.object);
    }
    closestGrid.object = model;
    var box3 = new THREE.Box3().setFromObject(model);
    var sizeBB = new THREE.Vector3();
    box3.getSize(sizeBB);
    model.position.copy(closestGrid.position.clone().add(new THREE.Vector3(0, sizeBB.y / 2, 0)));
  }
}

//====================================Sky====================================
const daySkyTexture = textureLoader.load('./textures/sky/sky1.png');
const duskSkyTexture = textureLoader.load('./textures/sky/sky2.png');
const eveningSkyTexture = textureLoader.load('./textures/sky/sky3.png');
const nightSkyTexture = textureLoader.load('./textures/sky/nightskycolor.png');

const SkyShader = {
  uniforms: {
      u_time: { value: 0.0 },
      u_night_texture: { value: nightSkyTexture },
      u_day_texture: { value: daySkyTexture },
      u_dusk_texture: { value: duskSkyTexture },
      u_evening_texture: { value: eveningSkyTexture },
  },
  vertexShader: `
      varying vec2 vUv; 
      
      void main() 
      {
        vUv = uv;  
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
  `,
  fragmentShader: `
      uniform sampler2D u_night_texture;
      uniform sampler2D u_day_texture; 
      uniform sampler2D u_dusk_texture;
      uniform sampler2D u_evening_texture;
      uniform float u_time;

      varying vec2 vUv;

      void main()
      {
        float hour = mod(u_time, 24.0);

        vec4 day_texture_color = texture2D(u_day_texture, vUv);
        vec4 night_color = texture2D(u_night_texture, vUv);
        vec4 dusk_texture_color = texture2D(u_dusk_texture, vUv);
        vec4 evening_texture_color = texture2D(u_evening_texture, vUv);
        vec4 final_color;

        if (hour >= 6.0 && hour < 16.0) 
        {
            final_color = day_texture_color;
        } 
        else if (hour >= 16.0 && hour < 18.0)
        {
            final_color = mix(day_texture_color, dusk_texture_color, (hour - 16.0) / 1.5);
        }
        else if (hour >= 18.0 && hour < 20.5)
        {
          final_color = mix(dusk_texture_color, evening_texture_color, (hour - 18.0) / 2.5);
        }
        else
        {
            final_color = night_color;
        }

        gl_FragColor = final_color;
      }
  `,
};

var skyMaterial = new THREE.ShaderMaterial({
  uniforms: SkyShader.uniforms,
  vertexShader: SkyShader.vertexShader,
  fragmentShader: SkyShader.fragmentShader,
  side: THREE.BackSide 
});

var skyGeometry = new THREE.SphereGeometry(1000, 32, 32);
var skyMesh = new THREE.Mesh(skyGeometry, skyMaterial);
scene.add(skyMesh);

//====================================Time=======================================
var gameTime = 600; //Define default game time in minutes'
/*
  The speed of game time relative to real time, 
  1 minute in game is equivalent to 2 seconds in real time
*/
const timeScale = 30;
const timeControls = { timeSpeed: 1, currentTime: 10 }; 
var lastTimestamp = Date.now();

//====================================Weather====================================
//Snow
//add particles
const particlesGeometry = new THREE.BufferGeometry();
const count = 30000;
const positions = new Float32Array(count * 3);

//random snow
  for (let i = 0; i < count * 3; i++) {
    positions[i] = Math.random() * 700-100

  }
    particlesGeometry.setAttribute("position",new THREE.BufferAttribute(positions, 3)
  );
//add texture
  const snowMaterial = new THREE.PointsMaterial();
  snowMaterial.size = 5;
  const Snowtexture = textureLoader.load('./textures/weather/snow.png');

    snowMaterial.map = Snowtexture;
    snowMaterial.alphaMap = Snowtexture;
    snowMaterial.transparent = true;
  
    snowMaterial.vertexColors = false;
    
const snow = new THREE.Points(particlesGeometry, snowMaterial);
snow.visible = false;
//add
scene.add(snow);

//Rain

//random rain 
  for (let i = 0; i < count * 3; i++) {
    positions[i] = Math.random() * 700-100;
    
  }
    particlesGeometry.setAttribute("position",new THREE.BufferAttribute(positions, 3)
  );
//add texture
  const RainMaterial = new THREE.PointsMaterial();
  RainMaterial.size = 5;
  const Raintexture = textureLoader.load('./textures/weather/rain.png');

  RainMaterial.map = Raintexture;
  RainMaterial.alphaMap = Raintexture;
  RainMaterial.transparent = true;
  
  RainMaterial.vertexColors = false;
    
const rain = new THREE.Points(particlesGeometry, RainMaterial);
rain.visible = false;
//add
scene.add(rain);


//===================================GUI Panel===================================
const gui = new GUI();
gui.add(timeControls, 'timeSpeed', 0, 100, 0.1).name('Time Speed'); 
gui.add(timeControls, 'currentTime', 0, 23.9, 0.1).name('Current Time').onChange(value => {
  gameTime = value * 60; 
});
gui.add(snow,'visible').name('Snowy').onChange(function(value) {
  if (value) {
    snow.visible = true;
  }
  else
  {
    snow.visible = false;
  }
});
gui.add(rain,'visible').name('Rainy').onChange(function(value) {
  if (value) {
    rainSound.play();
    rain.visible = true;
  } else {
    rain.visible = false;
    rainSound.pause();
    rainSound.currentTime = 0;
  }
});

gui.add(sound,'active').name('Bgm').onChange(function(value) {
  if (value) {
    bgm.play();
  } else {
    bgm.pause();
  }
});

gui.add(sound, 'volume', 0, 1, 0.1).name('Bgm Volume').onChange(function(value) {
  bgm.volume = value;
});

gui.add(sound, 'volume', 0, 1, 0.1).name('Sound Volume').onChange(function(value) {
  rainSound.volume = value;
});


var MyUpdateLoop = function ()
{
  renderer.render(scene, camera);
  controls.update();
  // Get the difference in milliseconds between the current time and the time of the previous frame
  timeUpdate();
  skyMesh.rotation.y += 0.00012;
  skyMesh.position.copy(camera.position);
  snow.position.y -= 0.05;
  rain.position.y -= 0.1;
  requestAnimationFrame(MyUpdateLoop);
};

function timeUpdate() {
  const now = Date.now();
  const deltaTime = (now - lastTimestamp) / 1000; 
  lastTimestamp = now;
  gameTime += deltaTime / 1000 / 60 * timeScale * (timeControls.timeSpeed * 1000);
  skyMaterial.uniforms.u_time.value = timeControls.currentTime = (gameTime / 60) % 24;
  let hour = timeControls.currentTime;
  if (hour >= 6 && hour < 18) { 
    let rad = (hour - 6) / 12 * Math.PI; 
    dirLight.position.x = 100 * Math.cos(rad); 
    dirLight.position.y = 100 * Math.sin(rad) + 20; 
    dirLight.position.z = 100 * Math.sin(rad); 
    dirLight.intensity = 1; 
    ambientLight.intensity = 0; 
  } else {
    dirLight.intensity = 0; 
    ambientLight.intensity = 2; 
  }

  dirLight.target.updateMatrixWorld(); 

}

requestAnimationFrame(MyUpdateLoop);

var MyResize = function ()
{
  var width = window.innerWidth;
  var height = window.innerHeight;
  renderer.setSize(width,height);
  camera.aspect = width/height;
  camera.updateProjectionMatrix();
  renderer.render(scene,camera);
};

window.addEventListener( 'resize', MyResize);
