let font

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


let inputs = []
let imgs = []
let done = false

function preload() {
	font = loadFont('https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf')
}

const pandemonium = new Pandemonium()

async function setup() {
  createCanvas(windowWidth, windowHeight, WEBGL)
	pixelDensity(1);
  const container = createElement('div')
  container.position(0, 0)
  container.style('display', 'flex')
  container.style('flex-direction', 'column')

  for (let i = 0; i < 2; i++) {
    inputs[i] = createFileInput((file) => {
      if (file.type === 'image') {
        imgs[i] = createImg(file.data, '');
        imgs[i].hide();
      } else {
        img[i] = null;
      }
      if (imgs.every((img) => !!img)) {
        drawResult()
      }
    })
    inputs[i].parent(container)
    inputs[i].style('color', 'white')
  }
  
  await pandemonium.setup()
}

async function drawResult() {
  pandemonium.reset()
  let first = true
  let seed = 0
  for (const img of imgs) {
    await pandemonium.run(img, { distort, smear: maxR, seed, first })
    await pandemonium.snapshot(img, { first })
    first = false
    seed++
  }
  push()
  scale(min(width/pandemonium.width(), height/pandemonium.height()))
  imageMode(CENTER);
	clear()
  pandemonium.draw()
  pop()
}


function windowResized() {
	resizeCanvas(windowWidth, windowHeight)
}

function draw() {}

function mouseClicked() {
	tapped = true;
	doStamp = true;
}

function buttonReleased() {
	pandemonium.save()
}
