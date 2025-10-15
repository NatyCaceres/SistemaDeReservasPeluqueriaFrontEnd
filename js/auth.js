const backendURL = "http://localhost:8080/auth";

document.addEventListener("DOMContentLoaded", () => {
    const loginForm = document.getElementById("loginForm");
    const registerForm = document.getElementById("registerForm");

    // === LOGIN ===
    if (loginForm) {
        loginForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const correo = document.getElementById("email").value;
            const contrasena = document.getElementById("password").value;

            try {
                const res = await fetch(`${backendURL}/login`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        correoElectronico: correo,
                        contrasena: contrasena
                    })
                });

                if (!res.ok) {
                    const msg = await res.text();
                    throw new Error(msg);
                }

                const data = await res.json();
                localStorage.setItem("token", data.token);

                alert("✅ Login exitoso");
                // Aquí podrías redirigir a la página de inicio del sistema
                // window.location.href = "reservas.html";
            } catch (err) {
                alert("❌ Error en login: " + err.message);
            }
        });
    }

    // === REGISTRO ===
    if (registerForm) {
        registerForm.addEventListener("submit", async (e) => {
            e.preventDefault();

            const nombre = document.getElementById("nombre").value;
            const correo = document.getElementById("correo").value;
            const contrasena = document.getElementById("password").value;

            try {
                const res = await fetch(`${backendURL}/register`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        nombre: nombre,
                        correoElectronico: correo,
                        contrasena: contrasena
                    })
                });

                if (!res.ok) {
                    const msg = await res.text();
                    throw new Error(msg);
                }

                alert("✅ Registro exitoso. Ya puedes iniciar sesión.");
                window.location.href = "index.html";
            } catch (err) {
                alert("❌ Error en registro: " + err.message);
            }
        });
    }
});
