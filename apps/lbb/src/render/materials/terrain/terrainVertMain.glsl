vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vWorldNormal = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);
