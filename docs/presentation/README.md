# Ролики StepPay

- `StepPay_demo.mp4` - демо продукта 1920x1080, 64 секунды: сценарий сделки на 3D-телефоне и ноутбуке, интерфейс меняется прямо на экране устройства, камера приближается к нужным местам. Рамки устройств с прозрачным экраном лежат в `video-src/public/frames`, углы экрана в `video-src/src/frames.json`.
- `StepPay_video.mp4` - ролик 1920x1080, 61 секунда.
- `video-src/` - исходники на Remotion. Экраны демо лежат в `video-src/public/demo`.
  Сборка: `npm i`, затем `npx remotion render Demo out.mp4` (демо) или `npx remotion render StepPay out.mp4`.
