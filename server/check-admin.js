const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function checkUser() {
  const user = await prisma.user.findUnique({
    where: { email: 'ozgurklc111@gmail.com' }
  });
  console.log('User Role:', user ? user.role : 'User not found');
  process.exit();
}

checkUser();
