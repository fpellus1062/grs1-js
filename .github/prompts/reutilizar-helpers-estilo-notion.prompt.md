---
description: "Refactoriza o implementa una vista reutilizando helpers y la API existente con una UI tipo Notion."
agent: "agent"
argument-hint: "Describe la pantalla, componente o flujo a trabajar"
---

Usa este prompt cuando quieras implementar o refactorizar una pantalla en GRS1 con estas prioridades:
- Reutilizar todos los helpers, componentes y utilidades existentes antes de crear lógica nueva.
- Reutilizar la API actual y evitar duplicar endpoints, transformaciones o contratos ya resueltos.
- Mantener una estética tipo Notion: limpia, editorial, con jerarquía tipográfica clara, mucho espacio en blanco, bordes suaves y estados discretos.
- Respetar la arquitectura y patrones del proyecto, haciendo cambios pequeños y consistentes.

Instrucciones:
1. Revisa el código cercano, los helpers compartidos, los servicios y los estilos ya existentes.
2. Si existe un helper o componente equivalente, úsalo en lugar de crear otro.
3. Si necesitas CSS, adapta la composición para un look tipo Notion sin romper la base visual del proyecto.
4. Evita inferencias complejas o lógica duplicada en wrappers y tablas; deja que el framework gestione los cambios cuando ya exista una vía estable.
5. Explica qué se reutilizó y qué se añadió solo si realmente faltaba algo.
6. Si algo no existe todavía, dilo explícitamente y propone la mínima extensión necesaria.

Salida esperada:
- Resumen corto del enfoque.
- Cambios concretos aplicados o propuestos.
- Riesgos, dependencias o huecos pendientes, si los hay.
