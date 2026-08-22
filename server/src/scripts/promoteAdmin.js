require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function makeSuperAdmin() {
  const email = 'ozgurklc111@gmail.com';
  try {
    const user = await prisma.user.update({
      where: { email },
      data: { role: 'admin' } // The schema uses 'admin' as the highest role in the comments, 
                              // but I'll set it to 'admin' as defined in the routes I just wrote.
    });
    console.log(`Successfully updated ${email} to admin role.`);
    console.log(user);
  } catch (error) {
    console.error(`Error updating user: ${error.message}`);
  } finally {
    await prisma.$disconnect();
  }
}

makeSuperAdmin();
