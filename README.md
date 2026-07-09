# Cashea — Tracker de Migraciones Base → Express

App interna para gestionar el pipeline de migraciones de aliados de modelo base a modelo express.

## Stack
- **Frontend**: Next.js 14 + TypeScript
- **Base de datos**: Supabase (PostgreSQL)
- **Deploy**: Vercel
- **Auth**: Validación server-side por correo @cashea.app

---

## Setup local

### 1. Instalar dependencias
```bash
npm install
```

### 2. Variables de entorno
Crea un archivo `.env.local` en la raíz con:
```
NEXT_PUBLIC_SUPABASE_URL=https://tavasnbpbknavsbfzyzg.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
```

### 3. Correr en desarrollo
```bash
npm run dev
```
Abre http://localhost:3000

---

## Gestión de usuarios autorizados

Los usuarios se gestionan directamente en la tabla `usuarios_autorizados` de Supabase.

Para agregar un usuario nuevo, ve al **SQL Editor** de Supabase y ejecuta:
```sql
INSERT INTO usuarios_autorizados (email, nombre, equipo)
VALUES ('nuevo@cashea.app', 'Nombre Apellido', 'MI');
```

Equipos válidos: `Legal`, `MI`, `Activaciones`, `Todos`

Para desactivar un usuario:
```sql
UPDATE usuarios_autorizados SET activo = false WHERE email = 'correo@cashea.app';
```

---

## Deploy en Vercel

1. Sube el código a GitHub (ver instrucciones abajo)
2. Ve a vercel.com → New Project → importa el repo
3. En **Environment Variables** agrega las tres variables del `.env.local`
4. Click en **Deploy**

Vercel desplegará automáticamente cada vez que hagas push a `main`.

---

## Subir a GitHub

```bash
# Desde la carpeta del proyecto
git init
git add .
git commit -m "feat: initial release - cashea migr tracker"
git branch -M main
git remote add origin https://github.com/TU_USUARIO/cashea-migr-tracker.git
git push -u origin main
```

---

## Estructura del proyecto

```
cashea-migr-tracker/
├── app/
│   ├── api/
│   │   ├── auth/route.ts        # Verificación de usuario (server)
│   │   └── importar/route.ts    # Importación CSV masiva (server)
│   ├── globals.css
│   ├── layout.tsx
│   └── page.tsx                 # App principal
├── lib/
│   ├── supabase.ts              # Cliente browser (publishable key)
│   ├── supabase-admin.ts        # Cliente server (secret key)
│   └── types.ts                 # Tipos TypeScript
├── .env.local                   # Credenciales (NO subir a git)
├── .env.example                 # Plantilla de variables
├── .gitignore
├── next.config.js
├── package.json
└── tsconfig.json
```

---

## Handoff a Tech

Este proyecto está listo para ser tomado por el equipo de desarrollo. Puntos clave:

- La secret key de Supabase nunca se expone al browser (vive en las API routes de Next.js)
- El schema de la base de datos está en Supabase con RLS habilitado
- Los usuarios autorizados se gestionan en la tabla `usuarios_autorizados`
- El código está en TypeScript con tipos definidos en `lib/types.ts`
- Para agregar autenticación real con Google OAuth: Supabase Auth tiene integración nativa, es 1-2 horas de trabajo adicional
