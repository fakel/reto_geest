# Especificación 00 - Workflow y Estrategia de Trabajo

## Estrategia de Desarrollo (Spec-Driven Development)
El desarrollo del proyecto se ejecutará de forma disciplinada, iterativa y guiada por las especificaciones definidas.

## Reglas para Commits

1. **Conventional Commits:**
   - Todos los mensajes de commit deben seguir estrictamente la especificación Angular / Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `ci:`, `refactor:`).
   - Esta regla es impuesta localmente mediante hooks de `husky`.

2. **Aprobación de Tareas:**
   - **SOLO** se realizará un commit en el repositorio después de que la tarea o incremento actual haya sido validado y aprobado formalmente.
   - Ninguna modificación de código se considerará terminada hasta contar con el visto bueno del flujo de revisión.

3. **Propuesta Transparente de Mensaje:**
   - Junto con cada petición de aprobación para completar una tarea, se propondrá explícitamente el mensaje de commit exacto que se utilizará para registrar los cambios.
   - Ejemplo de flujo de propuesta:
     > **Propuesta de Commit:** `feat(api): add idempotency plugin for fastify post endpoints`  
     > ¿Apruebas este cambio y el mensaje de commit para proceder?

## Estructura del Bucle de Trabajo (Loop SDD)

1. **Paso A (Spec/Design):** Definir o refinar el detalle técnico de la tarea actual en los documentos `specs/`.
2. **Paso B (Implementation & Testing):** Escribir los tests (`Vitest` / `pg-mem` / `prisma-mock`) y la implementación en el código.
3. **Paso C (Proposal & Approval):** Mostrar los resultados de las pruebas y proponer el mensaje de commit según Conventional Commits.
4. **Paso D (Commit & Progress):** Una vez aprobado, registrar el commit y actualizar la documentación/README.md.
