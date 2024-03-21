let secretNumber, minRange, maxRange, guessesLeft;
const guessedTooHigh = [];
const guessedTooLow = [];

document.getElementById('start-game').addEventListener('click', function() {
    minRange = parseInt(document.getElementById('min-range').value);
    maxRange = parseInt(document.getElementById('max-range').value);
    guessesLeft = parseInt(document.getElementById('guesses').value);
    secretNumber = Math.floor(Math.random() * (maxRange - minRange + 1)) + minRange;
    
    document.getElementById('gameplay').style.display = 'block';
    document.getElementById('feedback').innerHTML = '';
    document.getElementById('attempts').innerHTML = '';
});

document.getElementById('guess').addEventListener('click', function() {
    const userGuess = parseInt(document.getElementById('user-guess').value);
    let feedback = '';

    if (userGuess === secretNumber) {
        feedback = 'Damn right, you got it!';
        endGame();
    } else if (guessesLeft - 1 === 0) {
        feedback = `No more guesses left, the number was ${secretNumber}.`;
        endGame();
    } else {
        guessesLeft--;
        feedback = `Wrong! You have ${guessesLeft} guesses left.`;

        if (userGuess < secretNumber) {
            guessedTooLow.push(userGuess);
            feedback += ' Too low!';
        } else {
            guessedTooHigh.push(userGuess);
            feedback += ' Too high!';
        }

        updateAttempts();
    }

    document.getElementById('feedback').innerText = feedback;
});

function updateAttempts() {
    let attemptsHTML = `<strong>Too High:</strong> ${guessedTooHigh.join(', ')} <br> <strong>Too Low:</strong> ${guessedTooLow.join(', ')}`;
    document.getElementById('attempts').innerHTML = attemptsHTML;
}

function endGame() {
    document.getElementById('user-guess').disabled = true;
    document.getElementById('guess').disabled = true;
}
