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

    uniform bool debug;
    uniform int target;
    uniform bool sdf;
		
		uniform float maxR;

    varying vec2 vTexCoord;

    vec3 hsv2rgb(vec3 c)
    {
        vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
        vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
        return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
    }
		
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
      if (debug && sdf) {
        if (smoothR > 0.001) {
          gl_FragColor = mix(vec4(1.,0.,0.,1.), vec4(1.), map(smoothR, 0.001, maxR, 0., 1.));
        } else if (smoothR < 0.001) {
          gl_FragColor = mix(vec4(0.,0.,1.,1.), vec4(1.), map(smoothR, -0.001, -maxR, 0., 1.));
        } else {
          gl_FragColor = vec4(0.,0.,0.,1.);
        }
        return;
      }
			
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

      if (debug) {
        float r = (target == 0 ? closestPrevR : closestNextR);
        vec2 dir = (target == 0 ? dirPrev : dirNext);
        float angle = atan(dir.y, dir.x);
        vec3 angleColor = hsv2rgb(vec3(angle/${2*Math.PI}, 1., 1.));
        float dist = (1. - abs(closestNextR/maxR)) * (1. - abs(closestPrevR/maxR));
        gl_FragColor = vec4(angleColor * dist, 1.) * ((r < maxR && r > -maxR) ? 1. : 0.) * ((smoothR <= 0. && smoothR > -maxR) ? 1. : 0.);
        return;
      }
			
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

class Pandemonium {
  constructor({ fboSize = { width: 800, height: 800 } } = {}) {
    this.fboSize = fboSize
    this.running = false
  }
  
  async setup() {
    const fboSize = this.fboSize
    this.bg = createFramebuffer(fboSize)
    this.fg1 = createFramebuffer(fboSize)
    this.fg2 = createFramebuffer(fboSize)
    this.result = createFramebuffer(fboSize)

    this.captureData = createGraphics(fboSize.width, fboSize.height)
    this.maskData = createGraphics(fboSize.width, fboSize.height)
    this.fbo = createFramebuffer(fboSize)
    this.maskShader = createShader(...maskShaderSource())
    this.warpShader = createShader(...warpShaderSource())
    this.stampShader = createShader(...stampShaderSource())
    this.warp = createFilterShader(`precision highp float;
      uniform sampler2D tex0;
      uniform vec2 canvasSize;
      uniform float distort;
      varying vec2 vTexCoord;
      uniform float seed;
      void main() {
        gl_FragColor = texture2D(tex0, vTexCoord + 0.1*distort*vec2(sin(vTexCoord.y*distort*20. + seed*${Math.E}), 0.));
      }
    `)

    const model = bodySegmentation.SupportedModels.MediaPipeSelfieSegmentation;
    const segmenterConfig = {
      runtime: 'tfjs',
      solutionPath: 'https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@1.0.2'
    };
  
    this.segmenter = await bodySegmentation.createSegmenter(model, segmenterConfig)
  }

  ready() {
    return !!this.segmenter
  }

  running() {
    return this.running
  }

  width() {
    return this.fboSize.width
  }
  height() {
    return this.fboSize.height
  }

  async run(
    input,
    {
      distort = 0.1,
      smear = 0.1,
      seed = 0,
      first = false,
      debug = null,
    } = {}
  ) {
    if (this.running) return
    this.runPromise = (async () => {
      this.running = true
      this.captureData.clear()
      this.captureData.image(input, 0, 0, this.width(), this.height(), 0, 0, input.width, input.height, COVER)
      
      const res = await this.segmenter.segmentPeople(this.captureData.elt)
      const mask = res[0].mask.mask
      const img = await res[0].mask.toImageData()
      mask.dispose()
      this.maskData.clear()
      this.maskData.drawingContext.putImageData(img, 0, 0)
      this.maskData.filter(BLUR, 2)
      
      this.fbo.begin()
      clear()
      push()
      shader(this.maskShader)
      this.maskShader.setUniform('content', this.captureData)
      this.maskShader.setUniform('mask', this.maskData)
      noStroke()
      plane(this.fboSize.width, this.fboSize.height)
      pop()
      this.warp.setUniform('distort', distort)
      this.warp.setUniform('seed', seed)
      filter(this.warp)
      this.fbo.end()
      
      imageMode(CENTER);

      await new Promise((resolve) => requestAnimationFrame(() => {
        this.fg1.draw(() => {
          clear()
          imageMode(CENTER)

          push()
          shader(this.warpShader)
          this.warpShader.setUniform('prev', this.fg2)
          this.warpShader.setUniform('next', this.fbo)
          this.warpShader.setUniform('first', first)
          this.warpShader.setUniform('maxR', smear)
          this.warpShader.setUniform('debug', !!debug)
          this.warpShader.setUniform('sdf', debug && debug.mode === 'sdf')
          this.warpShader.setUniform('target', (debug && debug.target === 'prev') ? 0 : 1)
          noStroke()
          plane(this.fg1.width, this.fg1.height)
          pop()
        })

        this.running = false
        resolve()
      }))
    })();
    await this.runPromise
  }

  async snapshot(input, { first = false } = {}) {
    await this.runPromise
    this.fg2.draw(() => {
			clear()
			shader(this.stampShader)
			this.stampShader.setUniform('content', this.fg1)
			noStroke()
			plane(this.fg1.width, this.fg1.height)
		})
		if (first) {
			this.bg.draw(() => image(input, 0, 0, this.width(), this.height(), 0, 0, input.width, input.height, COVER))
		}
  }

  reset() {
    this.bg.draw(() => clear())
    this.fg1.draw(() => clear())
    this.fg2.draw(() => clear())
  }

  draw() {
    push()
    imageMode(CENTER);
    image(this.bg, 0, 0)
    image(this.fg1, 0, 0)
    pop()
  }

  save(name = 'pandemonium.png') {
    this.result.draw(() => {
      clear()
      imageMode(CENTER)
      image(this.bg, 0, 0)
      image(this.fg1, 0, 0)
    })
    const img = this.result.get()
    save(img, name)
  }
}
