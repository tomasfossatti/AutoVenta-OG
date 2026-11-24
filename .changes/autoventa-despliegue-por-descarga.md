---
impacto: nada_mudou
secao: alterado
titulo: Imágenes publicadas por commit para desplegar sin compilar
---

Cada commit de la rama principal publica sus imágenes con una etiqueta fija `sha-<commit>`, además de `main` y `latest`. El servidor del AutoVenta instala esa etiqueta en vez de compilar, y puede volver a la anterior si algo falla. El stack local sigue compilando como antes si no se le indica una imagen publicada.
