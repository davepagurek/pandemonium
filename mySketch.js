const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
const segmenterConfig = {
  runtime: 'tfjs',
  solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@1.0.2'
};
const segmentationConfig = { flipHorizontal: false, landscape: true };

let font

let segmenter
let capture
let running

let maskShader
let warpShader
let stampShader
let bgPicker
let picker
let video
let start

let fbo

OPC.slider({
	name: 'maxR',
	label: 'Smear',
	min: 0.01,
	max: 0.25,
	value: 0.1
})
OPC.slider({
	name: 'distort',
	label: 'Distort',
	min: 0,
	max: 1,
	value: 0.1
})
OPC.button('myButton', 'Save Image')

const vert = `
	precision highp float;
	precision highp int;

	attribute vec3 aPosition;
	attribute vec2 aTexCoord;
	attribute vec4 aVertexColor;

	uniform mat4 uModelViewMatrix;
	uniform mat4 uProjectionMatrix;

	varying vec2 vTexCoord;

	void main(void) {
		vec4 viewModelPosition = uModelViewMatrix * vec4(aPosition, 1.0);
		gl_Position = uProjectionMatrix * viewModelPosition;  
		vTexCoord = aTexCoord;
	}
`

function maskShaderSource() {
  const frag = `
    precision highp float;
    precision highp int;

    uniform sampler2D content;
    uniform sampler2D mask;

    varying vec2 vTexCoord;

    void main(void) {
      gl_FragColor = vec4(texture2D(content, vTexCoord).xyz, 1.) * smoothstep(0.3, 0.9, texture2D(mask, vTexCoord).x);
    }
  `

  return [vert, frag]
}

function stampShaderSource() {
  const frag = `
    precision highp float;
    precision highp int;

    uniform sampler2D content;

    varying vec2 vTexCoord;

    void main(void) {
      vec4 c = texture2D(content, vTexCoord);
			if (c.a > 0.) {
				gl_FragColor = c / c.a;
			} else {
				gl_FragColor = vec4(0.);
			}
    }
  `

  return [vert, frag]
}

function warpShaderSource() {
  const frag = `
    precision highp float;
    precision highp int;

    uniform sampler2D prev;
    uniform sampler2D next;
		uniform bool first;
		
		uniform float maxR;

    varying vec2 vTexCoord;
		
		float map(float value, float min1, float max1, float min2, float max2) {
			return clamp(
				min2 + (value - min1) * (max2 - min2) / (max1 - min1),
				min(min2, max2),
				max(min2, max2)
			);
		}
		
		float random(vec2 p) {
			vec3 p3  = fract(vec3(p.xyx) * .1031);
			p3 += dot(p3, p3.yzx + 33.33);
			return fract((p3.x + p3.y) * p3.z);
		}
		
		
		float opSmoothUnion( float d1, float d2, float k )
		{
				float h = clamp( 0.5 + 0.5*(d2-d1)/k, 0.0, 1.0 );
				return mix( d2, d1, h ) - k*h*(1.0-h);
		}

    void main(void) {
			if (first) {
				gl_FragColor = texture2D(next, vTexCoord);
				return;
			}
		
			float OPAQUE = 1.;
			
			bool onPrev = texture2D(prev, vTexCoord).a == OPAQUE;
			bool onNext = texture2D(next, vTexCoord).a == OPAQUE;
			
			float aOff = random(vTexCoord * 123.456);
			
			vec2 closestPrevAngle = vec2(0.);
			float prevAngleSamples = 0.;
			for (int i = 0; i < 100; i++) {
				float a = (float(i)/100. + aOff) * ${2 * Math.PI};
				vec2 off = vec2(cos(a), sin(a)) * maxR;
				vec2 pt = vTexCoord + off;
				float val = texture2D(prev, pt).a;
				if (onPrev ? val < OPAQUE : val >= OPAQUE) {
					closestPrevAngle += off;
					prevAngleSamples++;
				}
			}
			if (dot(closestPrevAngle, closestPrevAngle) > 0.) {
				closestPrevAngle = normalize(closestPrevAngle);
			} else {
				closestPrevAngle = vec2(0.);
			}
			
			float closestPrevR = maxR;
			for (int i = 0; i < 100; i++) {
				float r = maxR * ((float(i) + aOff)/100.);
				vec2 pt = vTexCoord + closestPrevAngle * r;
				float val = texture2D(prev, pt).a;
				if (onPrev ? val < OPAQUE : val >= OPAQUE) {
					closestPrevR = r;
					break;
				}
			}
			closestPrevR *= onPrev ? -1. : 1.;
			vec2 closestPrev = vTexCoord + closestPrevR * closestPrevAngle;
			
			vec2 closestNextAngle = vec2(0.);
			float nextAngleSamples = 0.;
			for (int i = 0; i < 100; i++) {
				float a = (float(i)/100. + aOff) * ${2 * Math.PI};
				vec2 off = vec2(cos(a), sin(a)) * maxR;
				vec2 pt = vTexCoord + off;
				float val = texture2D(next, pt).a;
				if (onNext ? val < OPAQUE : val >= OPAQUE) {
					closestNextAngle += off;
					nextAngleSamples++;
				}
			}
			if (dot(closestNextAngle, closestNextAngle) > 0.) {
				closestNextAngle = normalize(closestNextAngle);
			} else {
				closestNextAngle = vec2(0.);
			}
			
			float closestNextR = maxR;
			for (int i = 0; i < 100; i++) {
				float r = maxR * ((float(i) + aOff)/100.);
				vec2 pt = vTexCoord + closestNextAngle * r;
				float val = texture2D(next, pt).a;
				if (onNext ? val < OPAQUE : val >= OPAQUE) {
					closestNextR = r;
					break;
				}
			}
			closestNextR *= onNext ? -1. : 1.;
			vec2 closestNext = vTexCoord + closestNextR * closestNextAngle;
			
			float smoothR = clamp(opSmoothUnion(closestNextR, closestPrevR, maxR), -maxR, maxR);
			
			vec2 dirPrev = closestPrevAngle * (closestPrevR > 0. ? 1. : -1.);
			if (dirPrev.x != 0. && dirPrev.y != 0.) {
				dirPrev = normalize(dirPrev);
			}
			vec2 samplePrev = vTexCoord + dirPrev * maxR * (1. - abs(closestNextR/maxR)) * (1. - abs(closestPrevR/maxR)) * (smoothR < 0. ? 1. : 0.);
			
			vec2 dirNext = closestNextAngle * (closestNextR > 0. ? 1. : -1.);
			if (dirNext.x != 0. && dirNext.y != 0.) {
				dirNext = normalize(dirNext);
			}
			vec2 sampleNext = vTexCoord + dirNext * maxR * (1. - abs(closestNextR/maxR)) * (1. - abs(closestPrevR/maxR)) * (smoothR < 0. ? 1. : 0.);
			
			vec4 prevColor = texture2D(prev, samplePrev);
			vec4 nextColor = texture2D(next, sampleNext);
			
			float weightPrev = map(closestPrevR, -maxR, 0., 1., 0.);
			float weightNext = map(closestNextR, -maxR, 0., 1., 0.);
			float blendFactor = (weightPrev == 0. && weightNext == 0.) ? 0.5 : (weightNext / (weightPrev + weightNext));
			
			gl_FragColor = mix(prevColor, nextColor, clamp(blendFactor, 0., 1.)) * (smoothR < 0. ? 1. : 0.);
    }
  `

  return [vert, frag]
}

let cam
let bg
let fg1
let fb2
let result
let captureData
let maskData
let fboSize
let tapped = false
let first = true

function preload() {
	font = loadFont('https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf')
}

let doStamp = false
let warp
async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL)
	pixelDensity(1)
	const isMobile = window.navigator.userAgent && /Mobi|Android/i.test(window.navigator.userAgent)
  // cam = createCapture(VIDEO, { flipped: true })
	cam = createCapture(isMobile ? {
		audio: false,
    video: {
      facingMode: {
        exact: "environment"
      }
    },
	} : VIDEO, { flipped: !isMobile })
  cam.hide()
  fboSize = { width: 800, height: 800 }
  
  bg = createFramebuffer(fboSize)
  fg1 = createFramebuffer(fboSize)
	fg2 = createFramebuffer(fboSize)
	result = createFramebuffer(fboSize)
  
  captureData = createGraphics(fboSize.width, fboSize.height)
  maskData = createGraphics(fboSize.width, fboSize.height)
  fbo = createFramebuffer(fboSize)
  maskShader = createShader(...maskShaderSource())
	warpShader = createShader(...warpShaderSource())
	stampShader = createShader(...stampShaderSource())
	warp = createFilterShader(`precision highp float;
		uniform sampler2D tex0;
		uniform vec2 canvasSize;
		uniform float distort;
		varying vec2 vTexCoord;
		uniform float seed;
		void main() {
			gl_FragColor = texture2D(tex0, vTexCoord + 0.1*distort*vec2(sin(vTexCoord.y*distort*20. + seed*${Math.E}), 0.));
		}
	`)
  
  segmenter = await bodySegmentation.createSegmenter(model, segmenterConfig)
}

let didRun = false
let seed = 0

function windowResized() {
	resizeCanvas(windowWidth, windowHeight)
}

function draw() {
  if (!segmenter) return
	
	if (doStamp && !running) {
		// [fg1, fg2] = [fg2, fg1];
		fg2.draw(() => {
			clear()
			shader(stampShader)
			stampShader.setUniform('content', fg1)
			noStroke()
			plane(fg1.width, fg1.height)
		})
		if (first) {
			bg.draw(() => image(cam, 0, 0, fboSize.width, fboSize.height, 0, 0, cam.width, cam.height, COVER))
			first = false
		}
		doStamp = false
		seed++
	}
  
  if (!running) {
    running = true
    captureData.clear()
    captureData.image(cam, 0, 0, fboSize.width, fboSize.height, 0, 0, cam.width, cam.height, COVER)
    let mask
		
    segmenter.segmentPeople(captureData.elt, segmentationConfig).then((res) => {
      mask = res[0].mask.mask
      const data = res[0].mask.toImageData()
			mask.dispose()
			return data
    }).then((img) => {
      maskData.clear()
      maskData.drawingContext.putImageData(img, 0, 0)
      maskData.filter(BLUR, 2)
      // maskData.filter(ERODE)
			// maskData.filter(BLUR, 2)
      
      fbo.begin()
      clear()
			push()
      shader(maskShader)
      maskShader.setUniform('content', captureData)
      maskShader.setUniform('mask', maskData)
      noStroke()
      plane(fboSize.width, fboSize.height)
			pop()
			warp.setUniform('distort', distort)
			warp.setUniform('seed', seed)
			filter(warp)
      fbo.end()
			
			imageMode(CENTER);

			requestAnimationFrame(() => {
				fg1.draw(() => {
					clear()
					imageMode(CENTER)

					push()
					shader(warpShader)
					warpShader.setUniform('prev', fg2)
					warpShader.setUniform('next', fbo)
					warpShader.setUniform('first', !tapped)
					warpShader.setUniform('maxR', maxR)
					noStroke()
					plane(fg1.width, fg1.height)
					pop()
				})

				running = false
			})
    })
  }
  
	scale(min(width/fboSize.width, height/fboSize.height))
  imageMode(CENTER);
	clear()
	if (first) bg.draw(() => image(cam, 0, 0, fboSize.width, fboSize.height, 0, 0, cam.width, cam.height, COVER))
  image(bg, 0, 0)
  image(fg1, 0, 0)
	// image(fg2, 0, 0)
	// image(fbo, 0, 0)
	if (!tapped) {
		push()
		noStroke()
		fill(0, 100)
		rectMode(CENTER)
		rect(0, 0, 300, 50)
		
		textFont(font)
		textAlign(CENTER, CENTER)
		fill(255)
		textSize(30)
		text('Tap to stamp', 0, -4)
		pop()
	}
}

function mouseClicked() {
	tapped = true;
	doStamp = true;
}

function buttonReleased() {
	result.draw(() => {
		clear()
		imageMode(CENTER)
		image(bg, 0, 0)
		image(fg1, 0, 0)
	})
	const img = result.get()
	save(img, 'trails.png')
}
