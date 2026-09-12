// Physical output pixels, including export resolution and optical zoom.
export function projectedDiameter(camera,height,x,y,z,radius){
 const m=camera.matrixWorldInverse.elements;
 const depth=Math.max(camera.near,-(m[2]*x+m[6]*y+m[10]*z+m[14])-radius);
 return radius*height*Math.abs(camera.projectionMatrix.elements[5])/(camera.isOrthographicCamera?1:depth);
}

// A 20% return band prevents repeated switching while orbiting a boundary.
export function selectLOD(pixels,thresholds,previous=0,offset=0){
 // History stores the displayed tier; compare in the unbiased threshold space.
 previous=Math.max(0,previous-offset);
 let level=0;
 for(let i=0;i<thresholds.length;i++){
  if(pixels>thresholds[i]*(previous>i?1.2:1))break;
  level=i+1;
 }
 return Math.min(thresholds.length,level+offset);
}
