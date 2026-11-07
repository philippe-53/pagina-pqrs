CREATE DATABASE IF NOT EXISTS gestion_conjuntos
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE gestion_conjuntos;

CREATE TABLE IF NOT EXISTS persona (
  id_persona INT UNSIGNED NOT NULL AUTO_INCREMENT,
  tipo_doc VARCHAR(10) NOT NULL,
  nro_doc VARCHAR(30) NOT NULL,
  nombres VARCHAR(100) NOT NULL,
  apellidos VARCHAR(100) NOT NULL,
  email VARCHAR(150) NULL,
  telefono VARCHAR(30) NULL,
  fecha_nacimiento DATE NULL,
  estado_persona VARCHAR(30) NOT NULL DEFAULT 'Activo',
  PRIMARY KEY (id_persona),
  UNIQUE KEY uq_persona_nro_doc (nro_doc)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS usuario_app (
  id_usuario INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_persona INT UNSIGNED NOT NULL,
  nombre_usuario VARCHAR(80) NOT NULL,
  clave_hash VARCHAR(255) NOT NULL,
  rol VARCHAR(30) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ultimo_acceso TIMESTAMP NULL DEFAULT NULL,
  PRIMARY KEY (id_usuario),
  UNIQUE KEY uq_usuario_nombre (nombre_usuario),
  UNIQUE KEY uq_usuario_persona (id_persona),
  CONSTRAINT fk_usuario_persona FOREIGN KEY (id_persona) REFERENCES persona (id_persona)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS conjunto (
  id_conjunto INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(150) NOT NULL,
  PRIMARY KEY (id_conjunto),
  UNIQUE KEY uq_conjunto_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS torre (
  id_torre INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_conjunto INT UNSIGNED NOT NULL,
  nombre VARCHAR(80) NOT NULL,
  PRIMARY KEY (id_torre),
  UNIQUE KEY uq_torre_conjunto_nombre (id_conjunto, nombre),
  CONSTRAINT fk_torre_conjunto FOREIGN KEY (id_conjunto) REFERENCES conjunto (id_conjunto)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS piso (
  id_piso INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_torre INT UNSIGNED NOT NULL,
  numero VARCHAR(20) NOT NULL,
  PRIMARY KEY (id_piso),
  UNIQUE KEY uq_piso_torre_numero (id_torre, numero),
  CONSTRAINT fk_piso_torre FOREIGN KEY (id_torre) REFERENCES torre (id_torre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS tipo_unidad (
  id_tipo_unidad INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(80) NOT NULL,
  PRIMARY KEY (id_tipo_unidad),
  UNIQUE KEY uq_tipo_unidad_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS unidad (
  id_unidad INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_piso INT UNSIGNED NOT NULL,
  id_tipo_unidad INT UNSIGNED NOT NULL,
  numero VARCHAR(30) NOT NULL,
  PRIMARY KEY (id_unidad),
  UNIQUE KEY uq_unidad_piso_numero (id_piso, numero),
  CONSTRAINT fk_unidad_piso FOREIGN KEY (id_piso) REFERENCES piso (id_piso),
  CONSTRAINT fk_unidad_tipo FOREIGN KEY (id_tipo_unidad) REFERENCES tipo_unidad (id_tipo_unidad)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS responsable (
  id_responsable INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_persona INT UNSIGNED NOT NULL,
  id_unidad INT UNSIGNED NOT NULL,
  rol VARCHAR(50) NOT NULL DEFAULT 'Propietario',
  estado_responsable VARCHAR(30) NOT NULL DEFAULT 'Activo',
  PRIMARY KEY (id_responsable),
  UNIQUE KEY uq_responsable_persona_unidad (id_persona, id_unidad),
  CONSTRAINT fk_responsable_persona FOREIGN KEY (id_persona) REFERENCES persona (id_persona),
  CONSTRAINT fk_responsable_unidad FOREIGN KEY (id_unidad) REFERENCES unidad (id_unidad)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS estado_pqrs (
  id_estado INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(40) NOT NULL,
  descripcion VARCHAR(255) NULL,
  PRIMARY KEY (id_estado),
  UNIQUE KEY uq_estado_pqrs_nombre (nombre)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS pqrs (
  id_pqrs INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_persona INT UNSIGNED NOT NULL,
  id_unidad INT UNSIGNED NOT NULL,
  id_estado INT UNSIGNED NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  asunto VARCHAR(180) NOT NULL,
  descripcion TEXT NOT NULL,
  fecha_creacion DATE NOT NULL DEFAULT (CURRENT_DATE),
  estado_pqrs VARCHAR(40) NOT NULL DEFAULT 'Abierto',
  PRIMARY KEY (id_pqrs),
  KEY ix_pqrs_persona (id_persona),
  KEY ix_pqrs_unidad (id_unidad),
  KEY ix_pqrs_estado (id_estado),
  CONSTRAINT fk_pqrs_persona FOREIGN KEY (id_persona) REFERENCES persona (id_persona),
  CONSTRAINT fk_pqrs_unidad FOREIGN KEY (id_unidad) REFERENCES unidad (id_unidad),
  CONSTRAINT fk_pqrs_estado FOREIGN KEY (id_estado) REFERENCES estado_pqrs (id_estado)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS historial_pqrs (
  id_historial INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_pqrs INT UNSIGNED NOT NULL,
  id_estado INT UNSIGNED NOT NULL,
  fecha DATE NOT NULL DEFAULT (CURRENT_DATE),
  comentario VARCHAR(500) NULL,
  PRIMARY KEY (id_historial),
  KEY ix_historial_pqrs (id_pqrs),
  CONSTRAINT fk_historial_pqrs FOREIGN KEY (id_pqrs) REFERENCES pqrs (id_pqrs),
  CONSTRAINT fk_historial_estado FOREIGN KEY (id_estado) REFERENCES estado_pqrs (id_estado)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS respuesta_pqrs (
  id_respuesta INT UNSIGNED NOT NULL AUTO_INCREMENT,
  id_pqrs INT UNSIGNED NOT NULL,
  id_persona INT UNSIGNED NOT NULL,
  fecha DATE NOT NULL DEFAULT (CURRENT_DATE),
  respuesta TEXT NOT NULL,
  PRIMARY KEY (id_respuesta),
  KEY ix_respuesta_pqrs (id_pqrs),
  CONSTRAINT fk_respuesta_pqrs FOREIGN KEY (id_pqrs) REFERENCES pqrs (id_pqrs),
  CONSTRAINT fk_respuesta_persona FOREIGN KEY (id_persona) REFERENCES persona (id_persona)
) ENGINE=InnoDB;

CREATE OR REPLACE VIEW vista_respuestas_pqrs AS
SELECT id_pqrs, id_persona, fecha, respuesta
FROM respuesta_pqrs;

CREATE OR REPLACE VIEW vista_pqrs_dashboard AS
SELECT
  COUNT(p.id_pqrs) AS total_pqrs,
  COALESCE(SUM(LOWER(COALESCE(p.estado_pqrs, e.nombre, '')) = 'abierto'), 0) AS abiertos,
  COALESCE(SUM(LOWER(COALESCE(p.estado_pqrs, e.nombre, '')) = 'solucionado'), 0) AS solucionados,
  COALESCE(SUM(LOWER(COALESCE(p.estado_pqrs, e.nombre, '')) = 'en proceso'), 0) AS en_proceso
FROM pqrs p
LEFT JOIN estado_pqrs e ON e.id_estado = p.id_estado;

INSERT INTO conjunto (nombre)
VALUES ('Conjunto Residencial Local')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

INSERT INTO torre (id_conjunto, nombre)
SELECT id_conjunto, 'Torre 1'
FROM conjunto
WHERE nombre = 'Conjunto Residencial Local'
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

INSERT INTO piso (id_torre, numero)
SELECT id_torre, '1'
FROM torre
WHERE nombre = 'Torre 1'
ON DUPLICATE KEY UPDATE numero = VALUES(numero);

INSERT INTO tipo_unidad (nombre)
VALUES ('Apartamento')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

INSERT INTO unidad (id_piso, id_tipo_unidad, numero)
SELECT p.id_piso, tu.id_tipo_unidad, '101'
FROM piso p
INNER JOIN torre t ON t.id_torre = p.id_torre
INNER JOIN conjunto c ON c.id_conjunto = t.id_conjunto
CROSS JOIN tipo_unidad tu
WHERE c.nombre = 'Conjunto Residencial Local'
  AND t.nombre = 'Torre 1'
  AND p.numero = '1'
  AND tu.nombre = 'Apartamento'
ON DUPLICATE KEY UPDATE numero = VALUES(numero);

INSERT INTO persona (tipo_doc, nro_doc, nombres, apellidos, email, telefono, fecha_nacimiento, estado_persona)
VALUES ('CC', '1001', 'Residente', 'De Prueba', 'residente1001@local.test', '3000000001', '1990-01-01', 'Activo')
ON DUPLICATE KEY UPDATE nro_doc = VALUES(nro_doc);

INSERT INTO responsable (id_persona, id_unidad, rol, estado_responsable)
SELECT per.id_persona, u.id_unidad, 'Propietario', 'Activo'
FROM persona per
CROSS JOIN unidad u
INNER JOIN piso p ON p.id_piso = u.id_piso
INNER JOIN torre t ON t.id_torre = p.id_torre
INNER JOIN conjunto c ON c.id_conjunto = t.id_conjunto
WHERE per.nro_doc = '1001'
  AND u.numero = '101'
  AND p.numero = '1'
  AND t.nombre = 'Torre 1'
  AND c.nombre = 'Conjunto Residencial Local'
ON DUPLICATE KEY UPDATE estado_responsable = VALUES(estado_responsable);
