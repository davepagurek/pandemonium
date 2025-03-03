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
let imgs = [null, null]
let done = false

function preload() {
	font = loadFont('https://fonts.gstatic.com/s/inter/v18/UcCO3FwrK3iLTeHuS_nVMrMxCp50SjIw2boKoduKmMEVuLyfMZhrib2Bg-4.ttf')
}

const pandemonium = new Pandemonium()

async function setup() {
  createCanvas(900, 900, WEBGL)
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
	pixelDensity(2);
}

async function drawResult() {
  pandemonium.reset()
  let first = true
  let seed = 0
  const tmp = createFramebuffer({ width: 200, height: 200 })

  const rows = []
  for (const img of imgs) {
    const row = []
    tmp.draw(() => {
      clear()
      imageMode(CENTER)
      image(img, 0, 0, 200, 200, 0, 0, img.width, img.height, COVER)
    })
    row.push(tmp.get())
    await pandemonium.run(img, { distort, smear: maxR, seed, first, debug: { mode: 'sdf' } })
    row.push(pandemonium.maskData.get())
    row.push(pandemonium.fbo.get())
    row.push(pandemonium.fg1.get())
    await pandemonium.run(img, { distort, smear: maxR, seed, first, debug: { mode: 'offset', target: 'prev' } })
    row.push(pandemonium.fg1.get())
    await pandemonium.run(img, { distort, smear: maxR, seed, first, debug: { mode: 'offset', target: 'next' } })
    row.push(pandemonium.fg1.get())
    await pandemonium.run(img, { distort, smear: maxR, seed, first })
    row.push(pandemonium.fg1.get())
    rows.push(row)
    await pandemonium.snapshot(img, { first })
    first = false
    seed++
  }
  tmp.remove()

  push()
  background(255)
  translate(-width/2 + 20, -height/2 + 20)
  imageMode(CORNER)
  for (const [j, row] of rows.entries()) {
    push()
    for (const [i, img] of row.entries()) {
      save(img, `step-${j+1}-${i+1}.png`)
      if (i === 4) {
        translate(-220 * 4, 220)
      }
      if (i >= 4) {
        image(rows[0][0], 0, 0, 200, 200)
        image(row[6], 0, 0, 200, 200)
      }
      image(img, 0, 0, 200, 200)
      translate(220, 0)
    }
    pop()
    translate(0, 440)
  }
  pop()
}

function draw() {}

function mouseClicked() {
	tapped = true;
	doStamp = true;
}

function buttonReleased() {
	pandemonium.save()
}
