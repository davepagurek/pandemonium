

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



let cam
let tapped = false
let first = true

function preload() {
	font = loadFont('https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf')
}

let doStamp = false
let warp

const pandemonium = new Pandemonium()

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
  
  await pandemonium.setup()
}

let didRun = false
let seed = 0

function windowResized() {
	resizeCanvas(windowWidth, windowHeight)
}

function draw() {
  if (!pandemonium.ready()) return
	
	if (doStamp) {
		pandemonium.snapshot(cam, { first })
		doStamp = false
    first = false
		seed++
	}
  
  pandemonium.run(cam, { distort, smear: maxR, seed, first: !tapped })
  
	scale(min(width/pandemonium.width(), height/pandemonium.height()))
  imageMode(CENTER);
	clear()
  image(cam, 0, 0, pandemonium.width(), pandemonium.height(), 0, 0, cam.width, cam.height, COVER)
  pandemonium.draw()
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
	pandemonium.save()
}
