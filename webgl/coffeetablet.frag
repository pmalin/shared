// Coffee & Tablet - @P_Malin
 
#ifdef GL_ES
precision highp float;
#endif
 
uniform float time;
uniform vec2 mouse;
uniform vec2 resolution;
 
uniform sampler2D backbuffer;

float halfpi = asin(1.0);
float cos(float v){ // workaround for AMD Radeon on OS X
	return sin(v+halfpi);
}
 
#define PI 3.141592654
 
//#define ENABLE_MONTE_CARLO
#define ENABLE_PERLIN_NOISE
#define ENABLE_REFLECTIONS
#define ENABLE_FOG
#define ENABLE_SPECULAR
#define ENABLE_POINT_LIGHT
#define ENABLE_POINT_LIGHT_FLARE
 
#ifdef ENABLE_MONTE_CARLO
vec4 gPixelRandom;
vec3 gRandomNormal;
 
void CalcPixelRandom()
{
	vec4 s1 = sin(time * 3.3422 + gl_FragCoord.xxxx * vec4(324.324234, 563.324234, 657.324234, 764.324234)) * 543.3423;
	vec4 s2 = sin(time * 1.3422 + gl_FragCoord.yyyy * vec4(567.324234, 435.324234, 432.324234, 657.324234)) * 654.5423;
	gPixelRandom = fract(2142.4 + s1 + s2);
	gRandomNormal = normalize( gPixelRandom.xyz - 0.5);
}
 
#endif
 
#ifdef ENABLE_PERLIN_NOISE
 
#define NOISE_TILE_SIZE 64.0
#define NOISE_TILE_COUNT 4.0
 
#define kNoisePersistence 2.0
#define kNoiseAmplitude 0.04
 
float GetNoise( const in vec2 vPos )
{
	return fract(sin(vPos.x * 324.324234) * 234.324 + sin(vPos.y * 323.324234) * 122.324);
}
 
float GetSmoothNoise(const in vec2 vCoord, const in float fWrap)
{
	vec2 vCoordFloor = floor(vCoord);
	vec2 vCoordFract = fract(vCoord);
       
	vec2 vICoordFract = 1.0 - vCoordFract;
	
	vec4 vCoordPacked =  vCoordFloor.xyxy;
	vCoordPacked.zw += 1.0;
	vCoordPacked = mod(vCoordPacked, fWrap);
       
	float tl = GetNoise( vCoordPacked.xy );
	float tr = GetNoise( vCoordPacked.zy );
	float bl = GetNoise( vCoordPacked.xw );
	float br = GetNoise( vCoordPacked.zw );
			      
	return     tl * vICoordFract.x * vICoordFract.y
					+ tr * vCoordFract.x  * vICoordFract.y
					+ bl * vICoordFract.x * vCoordFract.y
					+ br * vCoordFract.x  * vCoordFract.y;
}
 
// we store the noise texture in the backbuffer alpha channel
float CalculateNoiseTexture()
{
	vec2 vTileIndex = floor(gl_FragCoord.xy / NOISE_TILE_SIZE);
	if(vTileIndex.y > 0.0)
	{
		return 1.0;
	}
       
	if(vTileIndex.x > NOISE_TILE_COUNT)
	{
		return 0.0;         
	}
       
	float fFrequency = pow(0.5, vTileIndex.x);
       
	float fThisNoise = GetSmoothNoise( gl_FragCoord.xy * fFrequency, NOISE_TILE_SIZE * fFrequency);
       
	float fSampledNoise = texture2D(backbuffer, (gl_FragCoord.xy + vec2(NOISE_TILE_SIZE, 0.0)) / resolution ).a;
       
	float fAmplitude = kNoiseAmplitude * pow(kNoisePersistence, vTileIndex.x);
	return fThisNoise * fAmplitude + fSampledNoise;
}
 
float SampleNoiseTexture( vec2 vUV )
{
	return texture2D(backbuffer, (fract(vUV) * NOISE_TILE_SIZE) / resolution ).a;
}
#else
float SampleNoiseTexture( vec2 vUV )
{
	return dot(sin(vUV * vec2(8.0,8.0)), vec2(0.5));
}
#endif
 
 
struct C_Ray
{
	vec3 vOrigin;
	vec3 vDir;
};

struct C_HitInfo
{
	vec3 vPos;
	float fDistance;
	vec3 vObjectId;
};

struct C_Material
{
	vec3 cAlbedo;
	float fR0;
	float fSmoothness;
	vec2 vParam;
};

vec3 RotateX( const in vec3 vPos, const in float fAngle )
{
	float s = sin(fAngle);
	float c = cos(fAngle);

	vec3 vResult = vec3( vPos.x, c * vPos.y + s * vPos.z, -s * vPos.y + c * vPos.z);

	return vResult;
}

vec3 RotateY( const in vec3 vPos, const in float fAngle )
{
	float s = sin(fAngle);
	float c = cos(fAngle);

	vec3 vResult = vec3( c * vPos.x + s * vPos.z, vPos.y, -s * vPos.x + c * vPos.z);

	return vResult;
}
      
vec3 RotateZ( const in vec3 vPos, const in float fAngle )
{
	float s = sin(fAngle);
	float c = cos(fAngle);

	vec3 vResult = vec3( c * vPos.x + s * vPos.y, -s * vPos.x + c * vPos.y, vPos.z);

	return vResult;
}

vec4 DistCombineUnion( const in vec4 v1, const in vec4 v2 )
{
	//if(v1.x < v2.x) return v1; else return v2;
	return mix(v1, v2, step(v2.x, v1.x));
}

vec4 DistCombineIntersect( const in vec4 v1, const in vec4 v2 )
{
	return mix(v2, v1, step(v2.x,v1.x));
}

vec4 DistCombineSubtract( const in vec4 v1, const in vec4 v2 )
{
	return DistCombineIntersect(v1, vec4(-v2.x, v2.yzw));
}

vec3 DomainRepeatXZGetTile( const in vec3 vPos, const in vec2 vRepeat, out vec2 vTile )
{
	vec3 vResult = vPos;
	vec2 vTilePos = (vPos.xz / vRepeat) + 0.5;
	vTile = floor(vTilePos + 1000.0);
	vResult.xz = (fract(vTilePos) - 0.5) * vRepeat;
	return vResult;
}

vec3 DomainRepeatXZ( const in vec3 vPos, const in vec2 vRepeat )
{
	vec3 vResult = vPos;
	vec2 vTilePos = (vPos.xz / vRepeat) + 0.5;
	vResult.xz = (fract(vTilePos) - 0.5) * vRepeat;
	return vResult;
}

vec3 DomainRepeatY( const in vec3 vPos, const in float fSize )
{
	vec3 vResult = vPos;
	vResult.y = (fract(vPos.y / fSize + 0.5) - 0.5) * fSize;
	return vResult;
}

vec3 DomainRotateSymmetry( const in vec3 vPos, const in float fSteps )
{
	float angle = atan( vPos.x, vPos.z );

	float fScale = fSteps / (PI * 2.0);
	float steppedAngle = (floor(angle * fScale + 0.5)) / fScale;

	float s = sin(-steppedAngle);
	float c = cos(-steppedAngle);

	vec3 vResult = vec3( c * vPos.x + s * vPos.z,
			     vPos.y,
			    -s * vPos.x + c * vPos.z);

	return vResult;
}

float GetDistanceXYTorus( const in vec3 p, const in float r1, const in float r2 )
{
	vec2 q = vec2(length(p.xy)-r1,p.z);
	return length(q)-r2;
}
 
float GetDistanceYZTorus( const in vec3 p, const in float r1, const in float r2 )
{
	vec2 q = vec2(length(p.yz)-r1,p.x);
	return length(q)-r2;
}
 
float GetDistanceCylinderY(const in vec3 vPos, const in float r)
{
	return length(vPos.xz) - r;
}
 
float GetDistanceBox( const in vec3 vPos, const in vec3 vSize )
{
	vec3 vDist = (abs(vPos) - vSize);
	return max(vDist.x, max(vDist.y, vDist.z));
}

float GetDistanceRoundedBox( const in vec3 vPos, const in vec3 vSize, float fRadius )
{
	vec3 vClosest = max(min(vPos, vSize), -vSize);
	return length(vClosest - vPos) - fRadius;
}


float GetDistanceMug( const in vec3 vPos )
{
	float fDistCylinderOutside = length(vPos.xz) - 1.0;
	float fDistCylinderInterior = length(vPos.xz) - 0.9;
	float fTop = vPos.y - 1.0;
       
	float r1 = 0.6;
	float r2 = 0.15;
	vec2 q = vec2(length(vPos.xy + vec2(1.2, -0.1))-r1,vPos.z);
	float fDistHandle = length(q)-r2;
       
	float fDistMug = max(max(min(fDistCylinderOutside, fDistHandle), fTop), -fDistCylinderInterior);
	return fDistMug;
}

float GetDistanceCoffee( const in vec3 vPos )
{
	float fTopCoffee = vPos.y - 0.7;
	float fDistCylinderCoffee = length(vPos.xz) - 0.95;
	
	float fDistCoffee = max(fTopCoffee, fDistCylinderCoffee);
	return fDistCoffee;
}

vec4 GetDistanceTablet( const in vec3 vPos )
{             
	vec3 vBevelPos = vPos - vec3(0.0, 1.71, 0.0);
	float r = 1.0;
	float fBevelDist = GetDistanceRoundedBox( vBevelPos, vec3(1.5, 1.0, 2.0), r );

	vec3 vCasePos = vPos - vec3(0.0, 0.0, 0.0);
	float fCaseDist = GetDistanceRoundedBox( vCasePos, vec3(1.5, 1.0, 2.0), 0.5 );

	vec4 vResult = vec4(max(fBevelDist, fCaseDist), 4.0, vPos.xz);
	
	vec4 vScreenDist = vec4(-vPos.y, 5.0, vPos.xz);
	vResult = DistCombineSubtract(vResult, vScreenDist);
       
	vec4 vButtonDist = vec4( length(vPos + vec3(0.0, -0.25, 2.1)) - 0.3, 5.0, vPos.xz);
	vResult = DistCombineSubtract(vResult, vButtonDist);
	
	return vResult;
}

// result is x=scene distance y=material or object id; zw are material specific parameters (maybe uv co-ordinates)
vec4 GetDistanceScene( const in vec3 vPos )
{           
	vec4 vResult = vec4(10000.0, -1.0, 0.0, 0.0);
	
	vec3 vMugDomain = vPos + vec3(2.4, 0.0, -2.0);
	vMugDomain = RotateY(vMugDomain, 1.0);
	
	vec4 vDistMug = vec4( GetDistanceMug(vMugDomain), 2.0, vMugDomain.xy);
	vResult = DistCombineUnion(vResult, vDistMug);
	
	vec4 vDistCoffee = vec4( GetDistanceCoffee(vMugDomain), 3.0, vMugDomain.xz);
	vResult = DistCombineUnion(vResult, vDistCoffee);
	
	vec4 vDistFloor = vec4(vPos.y + 1.0, 1.0, vPos.xz);
	vResult = DistCombineUnion(vResult, vDistFloor);
	
	vec3 vTabletDomain = vPos;
	vTabletDomain += vec3(-0.8, 0.7, 0.0);
	vTabletDomain = RotateY(vTabletDomain, -1.0);
	vec4 vDistTablet = GetDistanceTablet(vTabletDomain);
	vResult = DistCombineUnion(vResult, vDistTablet);
	
	return vResult;
}
 
C_Material GetObjectMaterial( const in vec3 vObjId, const in vec3 vPos )
{
	C_Material mat;
	
	if(vObjId.x < 1.5)
	{
		// floor
		float fBlend = SampleNoiseTexture(vPos.xz * 0.2 + vec2(0.0, sin(mod(vPos.x,4.0))));                    
		mat.fR0 = 0.02;
		mat.fSmoothness = fBlend;
		mat.cAlbedo = mix(vec3(0.7, 0.8, 0.3), vec3(0.5, 0.3, 0.1), fBlend);
	}
	else
	if(vObjId.x < 2.5)
	{
		// mug
		mat.fR0 = 0.05;
		mat.fSmoothness = 0.9;
		mat.cAlbedo = vec3(0.05, 0.35, 0.75);
	}
	else
	if(vObjId.x < 3.5)
	{
		// coffee
		mat.fR0 = 0.01;
		mat.fSmoothness = 1.0;
		mat.cAlbedo = vec3(0.5, 0.3, 0.2);
	}
	else
	if(vObjId.x < 4.5)
	{
		// tablet back
		mat.fR0 = 0.25;
		mat.fSmoothness = 0.0;
		mat.cAlbedo = vec3(0.8, 0.8, 0.8);                            
	}
	else
	{
		// tablet screen
		mat.fR0 = 0.01;
		mat.fSmoothness = 1.0;                               
		mat.cAlbedo = vec3(0.025);
	}
               	
	
	return mat;
}
 
vec3 GetSkyGradient( const in vec3 vDir )
{
	float fBlend = vDir.y * 0.5 + 0.5;
	return mix(vec3(0.0, 0.0, 0.0), vec3(0.4, 0.9, 1.0), fBlend);
}
 
vec3 GetLightPos()
{
	vec3 vLightPos = vec3(0.0, 1.0, 3.0);
	#ifdef ENABLE_MONTE_CARLO         
	vLightPos += gRandomNormal * 0.2;
	#endif
	return vLightPos;
}
 
vec3 GetLightCol()
{
	return vec3(32.0, 6.0, 1.0);
}

vec3 GetAmbientLight(const in vec3 vNormal)
{
	return GetSkyGradient(vNormal);
}
 
#define kFogDensity 0.0025
void ApplyAtmosphere(inout vec3 col, const in C_Ray ray, const in C_HitInfo intersection)
{
	#ifdef ENABLE_FOG
	// fog
	float fFogAmount = exp(intersection.fDistance * -kFogDensity);
	vec3 cFog = GetSkyGradient(ray.vDir);
	col = mix(cFog, col, fFogAmount);
	#endif
	
	// glare from light (a bit hacky - use length of closest approach from ray to light)
	#ifdef ENABLE_POINT_LIGHT_FLARE
	vec3 vToLight = GetLightPos() - ray.vOrigin;
	float fDot = dot(vToLight, ray.vDir);
	fDot = clamp(fDot, 0.0, intersection.fDistance);
	
	vec3 vClosestPoint = ray.vOrigin + ray.vDir * fDot;
	float fDist = length(vClosestPoint - GetLightPos());
	col += GetLightCol() * 0.01/ (fDist * fDist);
	#endif      
}
 
vec3 GetSceneNormal( const in vec3 vPos )
{
	// tetrahedron normal
	float fDelta = 0.025;

	vec3 vOffset1 = vec3( fDelta, -fDelta, -fDelta);
	vec3 vOffset2 = vec3(-fDelta, -fDelta,  fDelta);
	vec3 vOffset3 = vec3(-fDelta,  fDelta, -fDelta);
	vec3 vOffset4 = vec3( fDelta,  fDelta,  fDelta);

	float f1 = GetDistanceScene( vPos + vOffset1 ).x;
	float f2 = GetDistanceScene( vPos + vOffset2 ).x;
	float f3 = GetDistanceScene( vPos + vOffset3 ).x;
	float f4 = GetDistanceScene( vPos + vOffset4 ).x;

	vec3 vNormal = vOffset1 * f1 + vOffset2 * f2 + vOffset3 * f3 + vOffset4 * f4;

	return normalize( vNormal );
}
 
#define kRaymarchEpsilon 0.01
#define kRaymarchMatIter 256
#define kRaymarchStartDistance 0.1
 
// This is an excellent resource on ray marching -> http://www.iquilezles.org/www/articles/distfunctions/distfunctions.htm
void Raymarch( const in C_Ray ray, out C_HitInfo result, const float fMaxDist, const int maxIter )
{          
	result.fDistance = kRaymarchStartDistance;
	result.vObjectId.x = 0.0;
				    
	for(int i=0;i<=kRaymarchMatIter;i++)                
	{
		result.vPos = ray.vOrigin + ray.vDir * result.fDistance;
		vec4 vSceneDist = GetDistanceScene( result.vPos );
		result.vObjectId = vSceneDist.yzw;
	
		// abs allows backward stepping - should only be necessary for non uniform distance functions
		if((abs(vSceneDist.x) <= kRaymarchEpsilon) || (result.fDistance >= fMaxDist) || (i > maxIter))
		{
			break;
		}                          
	
		result.fDistance = result.fDistance + vSceneDist.x;      
	}
	
	
	if(result.fDistance >= fMaxDist)
	{
		result.vObjectId.x = 0.0;
		result.fDistance = 1000.0;
	}
}
 
float GetShadow( const in vec3 vPos, const in vec3 vLightDir, const in float fLightDistance )
{
	C_Ray shadowRay;
	shadowRay.vDir = vLightDir;
	shadowRay.vOrigin = vPos;

	C_HitInfo shadowIntersect;
	Raymarch(shadowRay, shadowIntersect, fLightDistance, 32);
													     
	return step(0.0, shadowIntersect.fDistance) * step(fLightDistance, shadowIntersect.fDistance );           
}
 
// http://en.wikipedia.org/wiki/Schlick's_approximation
float Schlick( const in vec3 vNormal, const in vec3 vView, const in float fR0, const in float fSmoothFactor)
{
	float fDot = dot(vNormal, -vView);
	fDot = min(max((1.0 - fDot), 0.0), 1.0);
	float fDot2 = fDot * fDot;
	float fDot5 = fDot2 * fDot2 * fDot;
	return fR0 + (1.0 - fR0) * fDot5 * fSmoothFactor;
}
 
float GetDiffuseIntensity(const in vec3 vLightDir, const in vec3 vNormal)
{
	return max(0.0, dot(vLightDir, vNormal));
}
 
float GetBlinnPhongIntensity(const in C_Ray ray, const in C_Material mat, const in vec3 vLightDir, const in vec3 vNormal)
{            
	vec3 vHalf = normalize(vLightDir - ray.vDir);
	float fNdotH = max(0.0, dot(vHalf, vNormal));

	float fSpecPower = exp2(4.0 + 6.0 * mat.fSmoothness);
	float fSpecIntensity = (fSpecPower + 2.0) * 0.125;

	return pow(fNdotH, fSpecPower) * fSpecIntensity;
}
 
// use distance field to evaluate ambient occlusion
float GetAmbientOcclusion(const in C_Ray ray, const in C_HitInfo intersection, const in vec3 vNormal)
{
	vec3 vPos = intersection.vPos;
	
	float fAmbientOcclusion = 1.0;
	
	float fDist = 0.0;
	for(int i=0; i<=5; i++)
	{
		fDist += 0.1;
	
		vec4 vSceneDist = GetDistanceScene(vPos + vNormal * fDist);
	
		fAmbientOcclusion *= 1.0 - max(0.0, (fDist - vSceneDist.x) * 0.2 / fDist );                                    
	}
	
	return fAmbientOcclusion;
}

vec3 GetObjectLighting(const in C_Ray ray, const in C_HitInfo intersection, const in C_Material material, const in vec3 vNormal, const in vec3 cReflection)
{
	vec3 cScene ;
	
	vec3 vSpecularReflection = vec3(0.0);
	vec3 vDiffuseReflection = vec3(0.0);
	
	float fAmbientOcclusion = GetAmbientOcclusion(ray, intersection, vNormal);
	vec3 vAmbientLight = GetAmbientLight(vNormal) * fAmbientOcclusion;
	
	vDiffuseReflection += vAmbientLight;
	
	vSpecularReflection += cReflection * fAmbientOcclusion;
		
	#ifdef ENABLE_POINT_LIGHT
	vec3 vLightPos = GetLightPos();
	vec3 vToLight = vLightPos - intersection.vPos;
	vec3 vLightDir = normalize(vToLight);
	float fLightDistance = length(vToLight);
	
	float fAttenuation = 1.0 / (fLightDistance * fLightDistance);
	
	float fShadowBias = 0.1;              
	float fShadowFactor = GetShadow( intersection.vPos + vLightDir * fShadowBias, vLightDir, fLightDistance - fShadowBias );
	vec3 vIncidentLight = GetLightCol() * fShadowFactor * fAttenuation;
	
	vDiffuseReflection += GetDiffuseIntensity( vLightDir, vNormal ) * vIncidentLight;                                                                                  
	vSpecularReflection += GetBlinnPhongIntensity( ray, material, vLightDir, vNormal ) * vIncidentLight;
	#endif ENABLE_POINT_LIGHT
	
	vDiffuseReflection *= material.cAlbedo;

	// emmissive glow from screen
	if(intersection.vObjectId.x > 4.5)
	{
		vec2 vScreenPos = intersection.vObjectId.zy * vec2(0.25, -0.3) + vec2(0.46, 0.5);
	       
		vec2 vMul = step(vScreenPos, vec2(1.0)) * step(vec2(0.0), vScreenPos);
		float fMul = vMul.x * vMul.y * 0.8;
		vDiffuseReflection += texture2D(backbuffer, vScreenPos).xyz * fMul;
	}
	
	
	#ifdef ENABLE_SPECULAR
	float fFresnel = Schlick(vNormal, ray.vDir, material.fR0, material.fSmoothness * 0.9 + 0.1);
	cScene = mix(vDiffuseReflection , vSpecularReflection, fFresnel);
	#else
	cScene = vDiffuseReflection;
	#endif
	
	return cScene;
}
 
vec3 GetSceneColourSimple( const in C_Ray ray )
{
	C_HitInfo intersection;
	Raymarch(ray, intersection, 16.0, 32);
			     
	vec3 cScene;
       
	if(intersection.vObjectId.x < 0.5)
	{
		cScene = GetSkyGradient(ray.vDir);
	}
	else
	{
		C_Material material = GetObjectMaterial(intersection.vObjectId, intersection.vPos);
		vec3 vNormal = GetSceneNormal(intersection.vPos);
      
		// use sky gradient instead of reflection
		vec3 cReflection = GetSkyGradient(reflect(ray.vDir, vNormal));
      
		// apply lighting
		cScene = GetObjectLighting(ray, intersection, material, vNormal, cReflection );
	}
       
	ApplyAtmosphere(cScene, ray, intersection);
       
	return cScene;
}
 
vec3 GetSceneColour( const in C_Ray ray )
{                                                           
	C_HitInfo intersection;
	Raymarch(ray, intersection, 30.0, 256);
		     
	vec3 cScene;
	
	if(intersection.vObjectId.x < 0.5)
	{
		cScene = GetSkyGradient(ray.vDir);
	}
	else
	{
		C_Material material = GetObjectMaterial(intersection.vObjectId, intersection.vPos);
		vec3 vNormal = GetSceneNormal(intersection.vPos);
	
		#ifdef ENABLE_MONTE_CARLO
		vNormal = normalize(vNormal + gRandomNormal / (5.0 + material.fSmoothness * 200.0));
		#endif
	
		vec3 cReflection;
		#ifdef ENABLE_REFLECTIONS	
		{
			// get colour from reflected ray
			float fSepration = 0.05;
			C_Ray reflectRay;
			reflectRay.vDir = reflect(ray.vDir, vNormal);
			reflectRay.vOrigin = intersection.vPos + reflectRay.vDir * fSepration;
									       
			cReflection = GetSceneColourSimple(reflectRay);                                                                          
		}
		#else
		cReflection = GetSkyGradient(reflect(ray.vDir, vNormal));                               
		#endif
		// apply lighting
		cScene = GetObjectLighting(ray, intersection, material, vNormal, cReflection );
	}
	
	ApplyAtmosphere(cScene, ray, intersection);
	
	return cScene;
}
 
void GetCameraRay( const in vec3 vPos, const in vec3 vForwards, const in vec3 vWorldUp, out C_Ray ray)
{
	vec2 vPixelCoord = gl_FragCoord.xy;
	#ifdef ENABLE_MONTE_CARLO
	vPixelCoord += gPixelRandom.zw;
	#endif
	vec2 vUV = ( vPixelCoord / resolution.xy );
	vec2 vViewCoord = vUV * 2.0 - 1.0;

	vViewCoord *= 0.75;
	
	float fRatio = resolution.x / resolution.y;

	vViewCoord.y /= fRatio;                            

	ray.vOrigin = vPos;

	vec3 vRight = normalize(cross(vForwards, vWorldUp));
	vec3 vUp = cross(vRight, vForwards);
	     
	ray.vDir = normalize( vRight * vViewCoord.x + vUp * vViewCoord.y + vForwards);         
}
 
void GetCameraRayLookat( const in vec3 vPos, const in vec3 vInterest, out C_Ray ray)
{
	vec3 vForwards = normalize(vInterest - vPos);
	vec3 vUp = vec3(0.0, 1.0, 0.0);

	GetCameraRay(vPos, vForwards, vUp, ray);
}
 
vec3 OrbitPoint( const in float fHeading, const in float fElevation )
{
	return vec3(sin(fHeading) * cos(fElevation), sin(fElevation), cos(fHeading) * cos(fElevation));
}
 
vec3 Tonemap( const in vec3 cCol )
{
	// simple Reinhard tonemapping operator      
	return cCol / (1.0 + cCol);
}
 
void main( void )
{
	#ifdef ENABLE_MONTE_CARLO              
	CalcPixelRandom();
	#endif
	
	C_Ray ray;
	
	vec3 vCameraPos = OrbitPoint(-mouse.x * 7.0, mouse.y * PI * 0.5) * 7.0 - vec3(0.0, 0.9, 0.0);
	#ifdef ENABLE_MONTE_CARLO              
	float fDepthOfField = 0.1;
	vCameraPos += gRandomNormal * 0.05;
	#endif
	
	GetCameraRayLookat( vCameraPos, vec3(0.0, 0.0, 0.0), ray);
	//GetCameraRayLookat(vec3(0.0, 0.0, -5.0), vec3(0.0, 0.0, 0.0), ray);
	
	vec3 cScene = GetSceneColour( ray );	
	
	float fExposure = 2.5;
	cScene = cScene * fExposure;
	vec3 cCurr = Tonemap(cScene );
	
	#ifdef ENABLE_MONTE_CARLO                              
	vec3 cPrev = texture2D(backbuffer, gl_FragCoord.xy / resolution).xyz;
	// would be nice to combine before tonemap but undoing a gamma=2.0 will do instead
	cPrev = cPrev * cPrev;
	// add noise to pixel value (helps values converge)
	cPrev += (gPixelRandom.xyz - 0.5) * (1.0 / 255.0);
	cCurr = cCurr * cCurr;
	// converge speed
	vec3 cFinal = mix(cPrev, cCurr, 8.0/255.0);
	// re-apply gamma 2.0
	cFinal = sqrt(cFinal);
	#else
	vec3 cFinal = cCurr;
	#endif
	
	float fAlpha = 1.0;
	#ifdef ENABLE_PERLIN_NOISE
	fAlpha = CalculateNoiseTexture();          
	#endif
	
	gl_FragColor = vec4( cFinal, fAlpha );
	
	//gl_FragColor = vec4(CalculateNoiseTexture()); // output noise texture
}