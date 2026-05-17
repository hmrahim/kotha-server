# Portfolio Backend API (MVC)

Full Express + Mongoose + MongoDB backend for portfolio site.

## Features
- User Auth (JWT)
- Projects CRUD (protected)
- Skills CRUD (protected)
- Contact form (public submit, admin view)

## Setup
1. Install MongoDB locally or use Atlas
2. Update `.env`:
```
MONGO_URI=mongodb://localhost:27017/portfolio
JWT_SECRET=your_secret_key
PORT=5000
```
3. `npm install`
4. `npm run dev`

## API Endpoints
```
POST /api/auth/register {username, email, password}
POST /api/auth/login {email, password}

GET /api/projects
POST /api/projects (auth)
GET/PUT/DELETE /api/projects/:id (auth)

GET /api/skills
POST /api/skills (auth)
PUT/DELETE /api/skills/:id (auth)

POST /api/contact {name, email, message} (public)
GET /api/contact (auth admin)
```

## Run
`npm run dev`

Test: http://localhost:5000
